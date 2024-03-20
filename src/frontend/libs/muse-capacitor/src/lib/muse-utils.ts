import { BleClient } from '@capacitor-community/bluetooth-le';
import { Subject } from 'rxjs';

// Provide an observable for a characteristic
export const startNotifications = async (device: string, service: string, characteristic: string) => {
    const observable = new Subject();
    await BleClient.startNotifications(device, service, characteristic, (v) => observable.next(v))
    return observable    
}

export const decodeResponse = (bytes: Uint8Array) => new TextDecoder().decode(bytes.subarray(1, 1 + bytes[0]));

export function encodeCommand(cmd: string) {
    const encoded = new TextEncoder().encode(`X${cmd}\n`);
    encoded[0] = encoded.length - 1;
    return new DataView(encoded.buffer); // Required for Capacitor
}
