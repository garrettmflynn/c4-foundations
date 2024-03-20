import uPlot from 'uplot';
import { ACCELEROMETER_FREQUENCY, ACCELEROMETER_SAMPLES_PER_READING, EEG_FREQUENCY, EEG_SAMPLES_PER_READING, MuseClient, PPG_FREQUENCY, PPG_SAMPLES_PER_READING, TelemetryData } from 'muse-capacitor/src/muse';
import { perc2color } from './utils';

import 'uplot'
import 'uplot/dist/uPlot.min.css'

type DataType = {
  eeg?: {
    [key: string]: any[]
  },
  telemetry?: {
    [key: string]: any[]
  },
  acceleration?: any[]
}

// ---------------------- Plot Options ----------------------
const plotHeight = 400
const uplotOpts = {
  series: [
    {},
    {
      // initial toggled state (optional)
      show: true,

      spanGaps: false,

      // in-legend display
      label: "Reading",
      // value: (self, rawValue) => "$" + rawValue.toFixed(2),

      // series style
      stroke: "red",
      width: 1,
      // fill: "rgba(255, 0, 0, 0.3)",
      // dash: [10, 5],
    }
  ],
};


// ---------------------- Worker threads ----------------------

// import AcquireWorker from '../services/workers/acquisition.worker?worker'
// import AnalyzeWorker from '../services/workers/analysis.worker?worker'

// // Share Worker Stuff
// const acquire = new AcquireWorker();
// const analyze = new AnalyzeWorker();
// const channel = new MessageChannel();
// acquire.postMessage({port: channel.port1}, [channel.port1]);
// analyze.postMessage({port: channel.port2}, [channel.port2]);

// analyze.onmessage = (e) => {
//   console.warn(`Worker Analysis Output - ${e.data}`, 'analysis-output')
// }

// ---------------------- Main thread ----------------------

const secondsToPlot = 4
const nEEGSamplesToPlot = Math.round((EEG_FREQUENCY / EEG_SAMPLES_PER_READING) * secondsToPlot)
const nPPGSamplesToPlot = Math.round((PPG_FREQUENCY / PPG_SAMPLES_PER_READING) * secondsToPlot)
const nAccSamplesToPlot = Math.round((ACCELEROMETER_FREQUENCY / ACCELEROMETER_SAMPLES_PER_READING) * secondsToPlot)
const accAxes = ['x', 'y', 'z']

// Elements
const graphs = document.getElementById('graphs')!
const batteryLevel = document.getElementById('battery')!.children[0] as HTMLElement
const temperature = document.getElementById('temperature') as HTMLElement
const hwVersion = document.getElementById('hardwareVersion')!
const fwVersion = document.getElementById('firmwareVersion')!

const connectInfo = document.getElementById('connect') as HTMLDivElement
const connectedInfo = document.getElementById('connected') as HTMLDivElement
const connectButton = document.getElementById('connect-button') as HTMLButtonElement
const disconnectButton = document.getElementById('disconnect-button') as HTMLButtonElement

// Muse Connection
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

    const updatedData = data.eeg[channel]
    updatedData.push(update)

    onchange('eeg', {
      channel,
      ...update
    }, updatedData)

  });

  client.telemetryData.subscribe((telemetry: TelemetryData) => {
    const now = Date.now()

    if (!data.telemetry) data.telemetry = {}

    for (let key in telemetry) {
      if (key === 'sequenceId') continue
      if (!data.telemetry[key]) data.telemetry[key] = []

      const update = { timestamp: now, value: telemetry[key] }

      const updatedData = data.telemetry[key]
      updatedData.push(update)

      onchange('telemetry', {
        key,
        ...update
      }, updatedData)
    }
  });

  client.accelerometerData.subscribe(acceleration => {
    const now = Date.now()
    if (!data.acceleration) data.acceleration = []
    const update = { timestamp: now, samples: acceleration.samples }
    const updatedData = data.acceleration
    updatedData.push(update)
    onchange('acceleration', update, updatedData)
  });

  client.ppgReadings.subscribe(reading => {
    const now = Date.now()
    if (!data.ppg) data.ppg = {}
    const channel = reading.ppgChannel
    if (!data.ppg[channel]) data.ppg[channel] = []
    const update  = { eegTimestamp: reading.timestamp, timestamp: now, samples: reading.samples }
    const updatedData = data.ppg[channel]
    updatedData.push(update)
    onchange('ppg', {
      channel,
      ...update
    }, updatedData)
  })

  return client
}

const plots: {[x:string]: uPlot} = {}

const updatePlotSize = (plot: uPlot) => plot.setSize({ width: graphs.offsetWidth, height: plotHeight })

document.body.onresize = () => Object.values(plots).forEach(plot => updatePlotSize(plot))

const plot = (label: string, data: any) => {

  // Create canvas if it doesn't exist
  if (!plots[label]) {
      const opts = {
        ...uplotOpts,
        id: label,
        title: label
      }
      const plot = new uPlot(opts, undefined, graphs);
      plots[label] = plot
  }

  // Plot the data
  const plot = plots[label];
  data[0] = data[0].map((n: any) => n / 1000) // Convert to seconds

  updatePlotSize(plot)

  plot.setData(data);
}

const onData = (data: any) => {
  if (data.error) return console.error(data.error)
  console.warn(`${data.source ? `${data.source} (${data.command})` : data.command} - ${JSON.stringify(data.payload)}`)
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

  const onDataChanged = (name: string, info: any, updatedData: any) => {

    if (name === 'eeg') {
      const { 
        channel, 
        // samples 
      } = info

      const dataToPlot = updatedData.slice(-nEEGSamplesToPlot)
      const formattedData = [
        dataToPlot.map(o => o.timestamp), // Timestamps
        dataToPlot.map(o => o.samples[o.samples.length - 1]) // Samples
      ]
      return plot(`EEG (${channel})`, formattedData)
    }

    else if (name === 'telemetry') {
      const { key, value } = info

      // Update Battery Indicator
      if (key === 'batteryLevel') return Object.assign(batteryLevel.style, {
        width: `${value}%`,
        background: perc2color(value)
      })

      else if (key === 'temperature') return temperature.innerHTML = `${value}°C`
    }

    else if (name === 'acceleration') {
      // const { samples } = info
      const dataToPlot = updatedData.slice(-nAccSamplesToPlot)
      const timestamps = dataToPlot.map(o => o.timestamp)
      const latestSamples = dataToPlot.map(o => o.samples[o.samples.length - 1]) // Last sample

      return accAxes.forEach((axis) => plot(`Acceleration ${axis}`, [
        timestamps,
        latestSamples.map((o: any) => o[axis])
      ] ))
    }

    else if (name === 'ppg') {
      const { 
        channel, 
        // samples 
      } = info

      const dataToPlot = updatedData.slice(-nPPGSamplesToPlot)
      const formattedData = [
        dataToPlot.map(o => o.timestamp), // Timestamps
        dataToPlot.map(o => o.samples[o.samples.length - 1]) // Samples
      ]

      return plot(`PPG (${channel})`, formattedData)
    }

    console.log('Uncaptured data', name, info)
  }

  if ('bluetooth' in plugins) {

      let client: MuseClient
      connectButton.addEventListener('click', async () => {
        client = await connectToMuse(onDataChanged)

        connectInfo.setAttribute('hidden', '')
        connectedInfo.removeAttribute('hidden')

        await client.deviceInfo().then(({ fw, hw }) => {
          hwVersion.innerHTML = hw
          fwVersion.innerHTML = fw
        });
      })

      disconnectButton.addEventListener('click', async () => {
        if (!client) return
        await client.disconnect()
                
        connectedInfo.setAttribute('hidden', '')
        connectInfo.removeAttribute('hidden')

      })

  } else connectButton.setAttribute('disabled', '')

})
