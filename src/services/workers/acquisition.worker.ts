onmessage = (e: MessageEvent) => {
  if (e.data.port instanceof MessagePort) {
    const myPort = e.data.port;

    myPort.onmessage = (e) => {
      console.log('Message sent back:', e.data);
    };

    setInterval(() => {
      myPort.postMessage(1);
    })
  }
};