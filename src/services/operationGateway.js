export function createNoopOperationGateway() {
  return Object.freeze({
    enabled: false,
    record() { return false },
    async flush() {},
    dispose() {}
  })
}
