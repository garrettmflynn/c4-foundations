// import { MuseClient } from '../../../muse-capacitor/src/muse';
import { MuseClient } from './libs/muse-capacitor/src/muse';
// import './capacitor-polyfill'

type DataType = {
  eeg?: {
    [key: string]: any[]
  },
  telemetry?: {
    [key: string]: any[]
  },
  acceleration?: any[]
}

import AcquireWorker from '../services/workers/acquisition.worker?worker'
import AnalyzeWorker from '../services/workers/analysis.worker?worker'

// Share Worker Stuff
const acquire = new AcquireWorker();
const analyze = new AnalyzeWorker();
const channel = new MessageChannel();
acquire.postMessage({port: channel.port1}, [channel.port1]);
analyze.postMessage({port: channel.port2}, [channel.port2]);

analyze.onmessage = (e) => {
  display(`<b>Worker Analysis Output</b> - ${e.data}`, 'analysis-output')
}

// Main thread
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

  const client = new MuseClient({
    ppg: true
  });

  await client.connect();
  await client.start();

  const data: DataType = {}

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

  client.ppgReadings.subscribe(reading => {
    const now = Date.now()
    if (!data.ppg) data.ppg = {}
    const channel = reading.ppgChannel
    if (!data.ppg[channel]) data.ppg[channel] = []
    const update  = { eegTimestamp: reading.timestamp, timestamp: now, samples: reading.samples }
    data.ppg[channel].push(update)
    onchange('ppg', {
      channel,
      ...update
    }, data)
  })

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

    else if (name === 'ppg') {
      const { channel, samples } = info
      const latestSample = samples[samples.length - 1]
      display(`<b>PPG (${channel})</b> ${latestSample.toFixed(5)}`, `ppg-${channel}`)
    }

    else console.log('Uncaptured data', name, info, data)
  }

  if (testBluetoothConnection) {
    if ('bluetooth' in plugins) testBluetoothConnection.addEventListener('click', async () => {
      const client = await connectToMuse(onDataChanged)
      const device = client.device
      display(`<b>Connected to Bluetooth Device</b> - ${device.name || `ID: ${device.deviceId}`}`)

      await client.deviceInfo().then(({ fw: firmwareVersion, hw: hardwareVersion }) => {
        console.log('Device Info', firmwareVersion, hardwareVersion)
      });
    })

    else testBluetoothConnection.setAttribute('disabled', '')
  }

})
