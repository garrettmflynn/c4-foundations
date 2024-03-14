import { BleClient, numberToUUID, numbersToDataView } from '@capacitor-community/bluetooth-le';


async function getServices(device: any) {
    const services = await BleClient.getServices(device.id);

    // Simulate getCharacteristic
    services.forEach(service => {
        service.device = device
        service.getCharacteristic = async (id: string) => getCharacteristic(device.id, service, id)
        return service
    })

    return services
}

async function getCharacteristic(deviceId: string, service: any, id: string) {

    const onUpdate = (value: any) => {
        console.log('Update', console.log(value));
    }

    const write = async (value: any) => {
        value = [...value]
        console.log('FIX WRITING', deviceId, service.uuid, id, value, numbersToDataView(value))
        try {
            return await BleClient.write(
                deviceId,
                service.uuid,
                id,
                numbersToDataView(value)
            );
        } catch (e) {
            console.error('Failed to write value', e)
        }
    }

    const events = {}

    const addEventListener = (event: string, callback: any) => {
        if (!events[event]) events[event] = {}
        events[event][callback] = callback
        console.log('Characteristic event listener added', id, event, callback, events)
    }

    const removeEventListener = (event: string, callback: any) => {
        if (!events[event]) return
        delete events[event][callback]
        console.log('Characteristic event listener removed', id, event, callback)
    }


    const info = {
        service,
        removeEventListener,
        addEventListener,
        startNotifications: async () => {
            return await BleClient.startNotifications(
                deviceId,
                service.uuid,
                id,
                onUpdate
            );
        },
        stopNotifications: async () => {
            return await BleClient.stopNotifications(
                deviceId,
                service.uuid,
                id
            );
        },
        writeValue: write,
        writeValueWithResponse: write,
        writeValueWithoutResponse: async (value: any) => {
            return await BleClient.writeWithoutResponse(
                deviceId,
                service.uuid,
                id,
                value
            );
        },

        readValue: async () => {
            const value = await BleClient.read(
                deviceId,
                service.uuid,
                id
            );
            return value
        }
    }

    return info
}

async function getPrimaryService(device: any) {
    const services = await getServices(device);
    return services[0]
}


// ----------------- Web Bluetooth Polyfill -----------------
const ogRequestDevice = navigator.bluetooth.requestDevice
navigator.bluetooth.requestDevice = async function (options: any = {}) {

    // options.namePrefix = options.namePrefix || 'Muse' // NOTE: Muse-specific

    if (this._isCalling) {
        this.calling = false
        return await ogRequestDevice.call(this, options)
    }

    // Ensure that the services are in UUID format
    const services = options.filters ? options.filters.map(o => o.services ?? []).flat() : options.services
    if (services) {
        options.services = services.map((service: any) => (typeof service === 'number') ? numberToUUID(service) : service)
        delete options.filters
    }

    await BleClient.initialize();
    this._isCalling = true
    const device = await BleClient.requestDevice(options)

    const { deviceId } = device
    device.id = deviceId

    // Muse.js Event polyfills
    device.addEventListener = (event: string, callback: any) => {
        console.log('Event listener added', event, callback)
    }

    device.removeEventListener = (event: string, callback: any) => {
        console.log('Event listener removed', event, callback)
    }

    await BleClient.connect(deviceId)


    device.gatt = {
        connect: () => device.gatt,
        disconnect: () => console.warn('Simulating GATT disconnection'),

        connected: true,

        device,

        getPrimaryServices: () => getServices(device),
        getPrimaryService: () => getPrimaryService(device)
    }

    return device
}
