import { createSocket } from 'dgram';
import { networkInterfaces } from 'os';
import { readFileSync, writeFileSync, existsSync } from 'fs';

export class SSDPServer {
  private socket: any;
  private port: number;
  private serverPort: number;
  private uuid: string;
  private intervalId: any;
  
  constructor(serverPort: number) {
    this.port = 1900;
    this.serverPort = serverPort;
    this.uuid = this.getOrCreateUUID();
  }
  
  private getOrCreateUUID(): string {
    const uuidFile = './.ssdp-uuid';
    
    if (existsSync(uuidFile)) {
      try {
        return readFileSync(uuidFile, 'utf-8').trim();
      } catch {
        // Fall through to generate new UUID
      }
    }
    
    // Generate a stable UUID based on a fixed prefix
    const uuid = 'f47ac10b-58cc-4372-a567-0e02b2c3d479';
    try {
      writeFileSync(uuidFile, uuid);
    } catch {
      // Ignore write errors
    }
    return uuid;
  }
  
  private getNetworkIP(): string {
    const interfaces = networkInterfaces();
    for (const name of Object.keys(interfaces)) {
      for (const iface of interfaces[name]!) {
        if (iface.family === 'IPv4' && !iface.internal) {
          return iface.address;
        }
      }
    }
    return '127.0.0.1';
  }
  
  start() {
    this.socket = createSocket({ type: 'udp4', reuseAddr: true });
    
    this.socket.on('message', (msg: Buffer, rinfo: any) => {
      const message = msg.toString();
      
      // Handle M-SEARCH requests
      if (message.includes('M-SEARCH') && message.includes('ssdp:discover')) {
        this.handleMSearch(rinfo);
      }
    });
    
    this.socket.on('listening', () => {
      console.log('🔍 SSDP Discovery server started on port 1900');
      this.socket.addMembership('239.255.255.250');
      
      // Send initial announcement
      this.sendNotify();
      
      // Send periodic announcements every 30 seconds
      this.intervalId = setInterval(() => {
        this.sendNotify();
      }, 30000);
    });
    
    this.socket.bind(this.port);
  }
  
  private handleMSearch(rinfo: any) {
    const ip = this.getNetworkIP();
    const response = [
      'HTTP/1.1 200 OK',
      'CACHE-CONTROL: max-age=1800',
      'EXT:',
      `LOCATION: http://${ip}:${this.serverPort}/device.xml`,
      'SERVER: UPnP/1.0 RuneCortex/1.0',
      'ST: urn:schemas-upnp-org:device:MediaServer:1',
      `USN: uuid:${this.uuid}::urn:schemas-upnp-org:device:MediaServer:1`,
      '',
      ''
    ].join('\r\n');
    
    // Send response after a small random delay (0-100ms) as per UPnP spec
    setTimeout(() => {
      this.socket.send(response, rinfo.port, rinfo.address);
    }, Math.random() * 100);
  }
  
  private sendNotify() {
    const ip = this.getNetworkIP();
    const messages = [
      // Device announcement
      [
        'NOTIFY * HTTP/1.1',
        'HOST: 239.255.255.250:1900',
        'CACHE-CONTROL: max-age=1800',
        `LOCATION: http://${ip}:${this.serverPort}/device.xml`,
        'NT: upnp:rootdevice',
        'NTS: ssdp:alive',
        'SERVER: UPnP/1.0 RuneCortex/1.0',
        `USN: uuid:${this.uuid}::upnp:rootdevice`,
        '',
        ''
      ].join('\r\n'),
      
      // Media server announcement
      [
        'NOTIFY * HTTP/1.1',
        'HOST: 239.255.255.250:1900',
        'CACHE-CONTROL: max-age=1800',
        `LOCATION: http://${ip}:${this.serverPort}/device.xml`,
        'NT: urn:schemas-upnp-org:device:MediaServer:1',
        'NTS: ssdp:alive',
        'SERVER: UPnP/1.0 RuneCortex/1.0',
        `USN: uuid:${this.uuid}::urn:schemas-upnp-org:device:MediaServer:1`,
        '',
        ''
      ].join('\r\n')
    ];
    
    messages.forEach(message => {
      this.socket.send(message, this.port, '239.255.255.250');
    });
  }
  
  stop() {
    if (this.intervalId) {
      clearInterval(this.intervalId);
    }
    
    if (this.socket) {
      // Send byebye messages
      const messages = [
        [
          'NOTIFY * HTTP/1.1',
          'HOST: 239.255.255.250:1900',
          'NT: upnp:rootdevice',
          'NTS: ssdp:byebye',
          `USN: uuid:${this.uuid}::upnp:rootdevice`,
          '',
          ''
        ].join('\r\n'),
        
        [
          'NOTIFY * HTTP/1.1',
          'HOST: 239.255.255.250:1900',
          'NT: urn:schemas-upnp-org:device:MediaServer:1',
          'NTS: ssdp:byebye',
          `USN: uuid:${this.uuid}::urn:schemas-upnp-org:device:MediaServer:1`,
          '',
          ''
        ].join('\r\n')
      ];
      
      messages.forEach(message => {
        this.socket.send(message, this.port, '239.255.255.250');
      });
      
      setTimeout(() => {
        this.socket.close();
      }, 100);
    }
  }
}