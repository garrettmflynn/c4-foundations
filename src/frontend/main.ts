import { BleClient } from '@capacitor-community/bluetooth-le';

const messages = document.getElementById('messages') as HTMLElement

const display = (message: string) => {
  messages.innerHTML += `<div>${message}</div>`
  messages.scrollTop = messages.scrollHeight;
}

const onData = (data: any) => {
  if (data.error) return console.error(data.error)

  console.log(data)
  display(`${data.source ? `${data.source} (${data.command})` : data.command} - ${JSON.stringify(data.payload)}`)
}

// --------- Python Service Test (OpenAPI) ---------
if (commoners.services.python) {

  const pythonUrl = new URL(commoners.services.python.url) // Equivalent to commoners://python

  const runCommands = async () => {
      fetch(new URL('connected', pythonUrl))
      .then(res => res.json())
      .then(payload => onData({ source: 'Python', command: 'connected', payload }))
      .catch(e => console.error('Failed to request from Python server', e))
  }

  const service = commoners.services.python
  if (commoners.target === 'desktop'){
    service.onActivityDetected(runCommands)

    service.onClosed(() => {
      console.error('Python server was closed!')
    })
  } 
  
  else runCommands()
 
}

commoners.ready.then(plugins => {

  // --------- Web Bluetooth Test ---------
  async function requestBluetoothDevice () {

    // Use the Capacitor API to support mobile
    await BleClient.initialize();
    const device = await BleClient.requestDevice({
      namePrefix: "Muse"
    });

    // const device = await navigator.bluetooth.requestDevice({ acceptAllDevices: true })
    console.log(device)
    display(`Connected to Bluetooth Device: ${device.name || `ID: ${device.id}`}`)
  }

  const testBluetoothConnection = document.getElementById('testBluetoothConnection')

  if (testBluetoothConnection) {
    if ('bluetooth' in plugins) testBluetoothConnection.addEventListener('click', requestBluetoothDevice)
    else testBluetoothConnection.setAttribute('disabled', '')
  }

})
