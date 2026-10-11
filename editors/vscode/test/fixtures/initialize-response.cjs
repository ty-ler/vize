exports.sendInitializeResponse = function sendInitializeResponse(id, capabilities, version, send) {
  send({
    id,
    jsonrpc: "2.0",
    result: {
      capabilities,
      serverInfo: {
        name: "fake-vize",
        version,
      },
    },
  });
};
