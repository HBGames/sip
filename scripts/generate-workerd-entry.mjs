import { mkdir, writeFile } from 'node:fs/promises';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = fileURLToPath(new URL('..', import.meta.url));
const jsPath = join(root, 'dist', 'workerd.js');
const dtsPath = join(root, 'dist', 'workerd.d.ts');

const js = `import createSipModule from './sip.js';
import sipWasm from './sip.wasm';

const globalScope = globalThis;

if (!globalScope.__SIP_WASM_LOADER__) {
  globalScope.__SIP_WASM_LOADER__ = async () =>
    createSipModule({
      instantiateWasm(imports, receiveInstance) {
        WebAssembly.instantiate(sipWasm, imports).then((result) => {
          receiveInstance(
            result instanceof WebAssembly.Instance ? result : result.instance
          );
        });
        return {};
      },
    });
}

export * from './index.js';
`;

const dts = `export * from './index.js';\n`;

await mkdir(dirname(jsPath), { recursive: true });
await writeFile(jsPath, js, 'utf8');
await writeFile(dtsPath, dts, 'utf8');
