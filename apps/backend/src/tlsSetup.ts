// allow self-signed certs for cloud postgres and elasticsearch
process.env.NODE_TLS_REJECT_UNAUTHORIZED = "0";

// suppress the Node.js TLS warning that the above variable generates
const _origEmitWarning = process.emitWarning.bind(process);
process.emitWarning = (warning: string | Error, ...rest: unknown[]) => {
  if (typeof warning === "string" && warning.includes("NODE_TLS_REJECT_UNAUTHORIZED")) return;
  return (_origEmitWarning as Function)(warning, ...rest);
};

// silence noisy managed redis eviction warning
const _origConsoleWarn = console.warn.bind(console);
console.warn = (...args: unknown[]) => {
  if (typeof args[0] === "string" && args[0].startsWith("IMPORTANT! Eviction policy")) return;
  return _origConsoleWarn(...args);
};
