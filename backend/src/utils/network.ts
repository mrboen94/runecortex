import { networkInterfaces } from 'os';

/**
 * Get the local IP address of the machine
 * Prioritizes IPv4 addresses and non-internal interfaces
 */
export function getLocalIpAddress(): string {
  const interfaces = networkInterfaces();
  
  // Look for IPv4 addresses that are not internal
  for (const name of Object.keys(interfaces)) {
    const addresses = interfaces[name];
    if (!addresses) continue;
    
    for (const addr of addresses) {
      // Skip internal (loopback) and IPv6 addresses
      if (!addr.internal && addr.family === 'IPv4') {
        return addr.address;
      }
    }
  }
  
  // Fallback to localhost if no external IP found
  return '127.0.0.1';
}