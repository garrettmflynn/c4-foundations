import { MuseClient } from 'muse-js';
// import './capacitor-polyfill'

const messages = document.getElementById('messages') as HTMLElement



const connectToMuse = async (onchange = ( name: string, info: any, data: any ) => {}) => {

  const indexToChannel = (index: number) => {
    switch (index) {
      case 0: return 'TP9'
      case 1: return 'AF7'
      case 2: return 'AF8'
      case 3: return 'TP10'
      case 4: return 'AUX'
      default: return 'Unknown'
    }
  }

  const client = new MuseClient();
  await client.connect();
  await client.start();

  const data = {}

  client.eegReadings.subscribe(reading => {
    const now = Date.now()
    if (!data.eeg) data.eeg = {}
    const channel = indexToChannel(reading.electrode)
    if (!data.eeg[channel]) data.eeg[channel] = []
    const update  = { eegTimestamp: reading.timestamp, timestamp: now, samples: reading.samples }
    data.eeg[channel].push(update)
    onchange('eeg', {
      channel,
      ...update
    }, data)
  });

  client.telemetryData.subscribe(telemetry => {
    const now = Date.now()
    if (!data.telemetry) data.telemetry = {}
    for (let key in telemetry) {
      if (key === 'sequenceId') continue
      if (!data.telemetry[key]) data.telemetry[key] = []

      const update = { timestamp: now, value: telemetry[key] }
      data.telemetry[key].push(update)
      onchange('telemetry', {
        key,
        ...update
      }, data)
    }
  });

  client.accelerometerData.subscribe(acceleration => {
    const now = Date.now()
    if (!data.acceleration) data.acceleration = []
    const update = { timestamp: now, samples: acceleration.samples }
    data.acceleration.push(update)
    onchange('acceleration', update, data)
  });

  return client
}

const display = (message: string, id?: string) => {
  const existing = id ? document.getElementById(id) : null

  if (existing) existing.innerHTML = message
  else messages.innerHTML += `<div id=${id}>${message}</div>`

  // messages.scrollTop = messages.scrollHeight;
}

const onData = (data: any) => {
  if (data.error) return console.error(data.error)
  display(`<b>${data.source ? `${data.source} (${data.command})` : data.command}</b> - ${JSON.stringify(data.payload)}`)
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
  const testBluetoothConnection = document.getElementById('testBluetoothConnection')

  const onDataChanged = (name: string, info: any, data: any) => {

    if (name === 'eeg') {
      const { channel, samples } = info
      const latestSample = samples[samples.length - 1]
      display(`<b>EEG (${channel})</b> ${latestSample.toFixed(5)}`, `eeg-${channel}`)
    }

    else if (name === 'telemetry') {
      const { key, value } = info
      display(`<b>Telemetry (${key})</b> ${value}`, `telemetry-${key}`)
    }

    else if (name === 'acceleration') {
      const { samples } = info
      const { x, y, z } = samples[samples.length - 1]
      display(`<b>Acceleration</b>\nx: ${x.toFixed(5)}\ny: ${y.toFixed(5)}\nz: ${z.toFixed(5)}`, 'acceleration')
    }
  }

  if (testBluetoothConnection) {
    if ('bluetooth' in plugins) testBluetoothConnection.addEventListener('click', async () => {
      const client = await connectToMuse(onDataChanged)
      const device = client.gatt.device
      display(`<b>Connected to Bluetooth Device</b> - ${device.name || `ID: ${device.id}`}`)
    })

    else testBluetoothConnection.setAttribute('disabled', '')
  }

})
