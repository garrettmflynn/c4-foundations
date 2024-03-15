onmessage = function(e: MessageEvent) {
  if (e.data.port instanceof MessagePort) {
    const myPort = e.data.port;
    myPort.onmessage = (e) => {
      const data = e.data
      const result = data + 1
      // myPort.postMessage(result)
      postMessage(result);
    }
  }
};