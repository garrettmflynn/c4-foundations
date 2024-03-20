import { BleClient, BleDevice, numberToUUID } from '@capacitor-community/bluetooth-le';

import { BehaviorSubject, merge, Observable, Subject } from 'rxjs';
import { filter, map, share, take } from 'rxjs/operators';

import type  {
    AccelerometerData,
    EEGReading,
    EventMarker,
    GyroscopeData,
    MuseControlResponse,
    MuseDeviceInfo,
    PPGReading,
    TelemetryData,
    XYZ,
} from './lib/muse-interfaces';

import {
    decodeEEGSamples,
    decodePPGSamples,
    parseAccelerometer,
    parseControl,
    parseGyroscope,
    parseTelemetry,
} from './lib/muse-parse';

import { decodeResponse, encodeCommand, observableCharacteristic, startNotifications } from './lib/muse-utils';

export {

    // Interfaces
    EEGReading,
    PPGReading,
    TelemetryData,
    AccelerometerData,
    GyroscopeData,
    XYZ,
    MuseControlResponse,
    MuseDeviceInfo,
};

export const MUSE_SERVICE = numberToUUID(0xfe8d);
const CONTROL_CHARACTERISTIC = '273e0001-4c4d-454d-96be-f03bac821358';
const TELEMETRY_CHARACTERISTIC = '273e000b-4c4d-454d-96be-f03bac821358';
const GYROSCOPE_CHARACTERISTIC = '273e0009-4c4d-454d-96be-f03bac821358';
const ACCELEROMETER_CHARACTERISTIC = '273e000a-4c4d-454d-96be-f03bac821358';
const PPG_CHARACTERISTICS = [
    '273e000f-4c4d-454d-96be-f03bac821358', // ambient 0x37-0x39
    '273e0010-4c4d-454d-96be-f03bac821358', // infrared 0x3a-0x3c
    '273e0011-4c4d-454d-96be-f03bac821358', // red 0x3d-0x3f
];
export const PPG_FREQUENCY = 64;
export const PPG_SAMPLES_PER_READING = 6;
const EEG_CHARACTERISTICS = [
    '273e0003-4c4d-454d-96be-f03bac821358',
    '273e0004-4c4d-454d-96be-f03bac821358',
    '273e0005-4c4d-454d-96be-f03bac821358',
    '273e0006-4c4d-454d-96be-f03bac821358',
    '273e0007-4c4d-454d-96be-f03bac821358',
];
export const EEG_FREQUENCY = 256;
export const EEG_SAMPLES_PER_READING = 12;

// These names match the characteristics defined in PPG_CHARACTERISTICS above
export const ppgChannelNames = ['ambient', 'infrared', 'red'];

// These names match the characteristics defined in EEG_CHARACTERISTICS above
export const channelNames = ['TP9', 'AF7', 'AF8', 'TP10', 'AUX'];

export class MuseClient {
    enableAux = false;
    enablePpg = false;
    deviceName: string | null = '';
    connectionStatus = new BehaviorSubject<boolean>(false);
    rawControlData: Observable<string>;
    controlResponses: Observable<MuseControlResponse>;
    telemetryData: Observable<TelemetryData>;
    gyroscopeData: Observable<GyroscopeData>;
    accelerometerData: Observable<AccelerometerData>;
    eegReadings: Observable<EEGReading>;
    ppgReadings: Observable<PPGReading>;
    eventMarkers: Subject<EventMarker>;

    private gatt: BluetoothRemoteGATTServer | null = null;
    private controlChar: BluetoothRemoteGATTCharacteristic;
    private eegCharacteristics: Observable<DataView>[];
    private ppgCharacteristics: Observable<DataView>[];

    private lastIndex: number | null = null;
    private lastTimestamp: number | null = null;


    device?: BleDevice;

    writeValue = async (characteristicId: string, value: DataView) => {
        if (!this.device) return;
        await BleClient.writeWithoutResponse(this.device.deviceId, MUSE_SERVICE, characteristicId, value); // NOTE: Muse assumes write without response
    }

    async connect(device?: BleDevice) {

        await BleClient.initialize();

        if (device) this.device = device;
        else {

            this.device = await BleClient.requestDevice({
                services: [ MUSE_SERVICE ],
            });
            
            await BleClient.connect(this.device.deviceId, () => {
                delete this.device;
                this.connectionStatus.next(false);
            });    
        }

        this.deviceName = this.device.name || null;
        const deviceId = this.device.deviceId;

        // Control
        const controlCharacteristic = await startNotifications(deviceId, MUSE_SERVICE, CONTROL_CHARACTERISTIC);

        this.rawControlData = controlCharacteristic.pipe(
            map((data) => decodeResponse(new Uint8Array(data.buffer))),
            share(),
        );
        
        this.controlResponses = parseControl(this.rawControlData);

        // Battery
        const telemetryCharacteristic = await startNotifications(deviceId, MUSE_SERVICE, TELEMETRY_CHARACTERISTIC);
        this.telemetryData = telemetryCharacteristic.pipe(map(parseTelemetry));

        // Gyroscope
        const gyroscopeCharacteristic = await startNotifications(deviceId, MUSE_SERVICE, GYROSCOPE_CHARACTERISTIC);
        this.gyroscopeData = gyroscopeCharacteristic.pipe(map(parseGyroscope));

        // Accelerometer
        const accelerometerCharacteristic = await startNotifications(deviceId, MUSE_SERVICE, ACCELEROMETER_CHARACTERISTIC);
        this.accelerometerData = accelerometerCharacteristic.pipe(
            map(parseAccelerometer),
        );

        this.eventMarkers = new Subject();

        // PPG
        if (this.enablePpg) {
            this.ppgCharacteristics = [];
            const ppgObservables = [];
            const ppgChannelCount = PPG_CHARACTERISTICS.length;
            for (let ppgChannelIndex = 0; ppgChannelIndex < ppgChannelCount; ppgChannelIndex++) {
                const characteristicId = PPG_CHARACTERISTICS[ppgChannelIndex];
                const ppgChar = await startNotifications(deviceId, MUSE_SERVICE, characteristicId);
                ppgObservables.push(
                    ppgChar.pipe(
                        map((data) => {
                            const eventIndex = data.getUint16(0);
                            return {
                                index: eventIndex,
                                ppgChannel: ppgChannelIndex,
                                samples: decodePPGSamples(new Uint8Array(data.buffer).subarray(2)),
                                timestamp: this.getTimestamp(eventIndex, PPG_SAMPLES_PER_READING, PPG_FREQUENCY),
                            };
                        }),
                    ),
                );
                this.ppgCharacteristics.push(ppgChar);
            }
            this.ppgReadings = merge(...ppgObservables);
        }

        // EEG
        this.eegCharacteristics = [];
        const eegObservables = [];
        const channelCount = this.enableAux ? EEG_CHARACTERISTICS.length : 4;
        for (let channelIndex = 0; channelIndex < channelCount; channelIndex++) {
            const characteristicId = EEG_CHARACTERISTICS[channelIndex];
            const eegChar = await startNotifications(deviceId, MUSE_SERVICE, characteristicId);
            eegObservables.push(
                eegChar.pipe(
                    map((data) => {
                        const eventIndex = data.getUint16(0);
                        return {
                            electrode: channelIndex,
                            index: eventIndex,
                            samples: decodeEEGSamples(new Uint8Array(data.buffer).subarray(2)),
                            timestamp: this.getTimestamp(eventIndex, EEG_SAMPLES_PER_READING, EEG_FREQUENCY),
                        };
                    }),
                ),
            );
            this.eegCharacteristics.push(eegChar);
        }
        this.eegReadings = merge(...eegObservables);
        this.connectionStatus.next(true);
    }

    async start() {
        await this.pause();
        let preset = 'p21';
        if (this.enablePpg) {
            preset = 'p50';
        } else if (this.enableAux) {
            preset = 'p20';
        }

        await this.sendCommand(preset);
        await this.sendCommand('s');
        await this.resume();
    }

    async deviceInfo() {
        const resultListener = this.controlResponses
            .pipe(
                filter((r) => !!r.fw),
                take(1),
            )
            .toPromise();
        await this.sendCommand('v1');
        return resultListener as Promise<MuseDeviceInfo>;
    }


    disconnect() {
        if (this.device) {
            this.lastIndex = null;
            this.lastTimestamp = null;
            BleClient.disconnect(this.device.deviceId);
            this.connectionStatus.next(false);
        }
    }

    sendCommand = (cmd: string) => this.writeValue(CONTROL_CHARACTERISTIC, encodeCommand(cmd))

    pause = () => this.sendCommand('h');

    resume = () => this.sendCommand('d');

    injectMarker = (value: string | number, timestamp: number = new Date().getTime()) => this.eventMarkers.next({ value, timestamp });


    private getTimestamp(eventIndex: number, samplesPerReading: number, frequency: number) {
        const READING_DELTA = 1000 * (1.0 / frequency) * samplesPerReading;
        if (this.lastIndex === null || this.lastTimestamp === null) {
            this.lastIndex = eventIndex;
            this.lastTimestamp = new Date().getTime() - READING_DELTA;
        }

        // Handle wrap around
        while (this.lastIndex - eventIndex > 0x1000) {
            eventIndex += 0x10000;
        }

        if (eventIndex === this.lastIndex) {
            return this.lastTimestamp;
        }
        if (eventIndex > this.lastIndex) {
            this.lastTimestamp += READING_DELTA * (eventIndex - this.lastIndex);
            this.lastIndex = eventIndex;
            return this.lastTimestamp;
        } else {
            return this.lastTimestamp - READING_DELTA * (this.lastIndex - eventIndex);
        }
    }
}
