import createSipModule from './sip.js';
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
