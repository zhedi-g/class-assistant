declare module '@jitsi/rnnoise-wasm/dist/rnnoise.js' {
  const createRNNWasmModule: (opt?: { locateFile?: (path: string) => string }) => Promise<any>
  export default createRNNWasmModule
}
