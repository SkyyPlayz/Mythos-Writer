// electron-vite `?nodeWorker` import suffix (SKY-10730): the plugin bundles
// the referenced module as a separate worker chunk in out/main and rewrites
// the import to a factory returning a node:worker_threads Worker.
// https://electron-vite.org/guide/dev#worker-threads

declare module '*?nodeWorker' {
  import type { Worker, WorkerOptions } from 'node:worker_threads';
  const createWorker: (options?: WorkerOptions) => Worker;
  export default createWorker;
}
