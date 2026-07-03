import * as net from 'net';

/**
 * Scans a list of ports on localhost to see if they are active (checking both IPv4 and IPv6 loopbacks).
 */
export async function detectActivePorts(ports: number[]): Promise<number[]> {
    const activePorts: number[] = [];
    
    const checkPort = (port: number): Promise<boolean> => {
        return new Promise((resolve) => {
            const socket = new net.Socket();
            socket.setTimeout(250); // fast timeout for local connections

            socket.on('connect', () => {
                socket.destroy();
                resolve(true);
            });

            socket.on('timeout', () => {
                socket.destroy();
                resolve(false);
            });

            socket.on('error', () => {
                socket.destroy();
                // If IPv4 failed, fall back to IPv6 loopback (::1) which is standard for modern dev servers (Vite, Next, etc.)
                const ipv6Socket = new net.Socket();
                ipv6Socket.setTimeout(250);
                ipv6Socket.on('connect', () => {
                    ipv6Socket.destroy();
                    resolve(true);
                });
                ipv6Socket.on('timeout', () => {
                    ipv6Socket.destroy();
                    resolve(false);
                });
                ipv6Socket.on('error', () => {
                    ipv6Socket.destroy();
                    resolve(false);
                });
                ipv6Socket.connect(port, '::1');
            });

            socket.connect(port, '127.0.0.1');
        });
    };

    // Scan ports sequentially to avoid socket overloading
    for (const port of ports) {
        try {
            const active = await checkPort(port);
            if (active) {
                activePorts.push(port);
            }
        } catch {
            // Ignore error
        }
    }

    return activePorts;
}
