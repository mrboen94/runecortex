#!/usr/bin/env bun

/**
 * Configuration checker for RuneCortex
 */

import { existsSync } from 'fs';
import { join } from 'path';

console.log('🔍 RuneCortex Configuration Check\n');

// Check for .env file
const envPath = join(process.cwd(), '.env');
if (!existsSync(envPath)) {
  console.log('⚠️  No .env file found. Using default configuration.');
  console.log('   Run: cp .env.example .env\n');
} else {
  console.log('✅ Found .env file\n');
}

// Plugin Configuration
console.log('🔌 Plugin Configuration:');
console.log('─'.repeat(40));

const plugins = [
  { name: 'Jellyfin API', env: 'JELLYFIN_ENABLED', default: 'true', description: 'Infuse app compatibility' },
  { name: 'DLNA Server', env: 'DLNA_ENABLED', default: 'true', description: 'Traditional DLNA/UPnP' },
  { name: 'SSDP Discovery', env: 'SSDP_ENABLED', default: 'true', description: 'Device discovery' },
  { name: 'M3U Playlists', env: 'M3U_ENABLED', default: 'true', description: 'VLC playlist support' },
];

for (const plugin of plugins) {
  const value = process.env[plugin.env] || plugin.default;
  const enabled = value !== 'false';
  console.log(`${enabled ? '✅' : '❌'} ${plugin.name.padEnd(15)} - ${plugin.description}`);
}

// Performance Configuration
console.log('\n⚡ Performance Configuration:');
console.log('─'.repeat(40));

const perfSettings = [
  { name: 'Concurrent Thumbnails', env: 'THUMBNAIL_MAX_CONCURRENT', default: '8' },
  { name: 'Batch Size', env: 'THUMBNAIL_BATCH_SIZE', default: '50' },
  { name: 'Batch Wait (sec)', env: 'THUMBNAIL_BATCH_WAIT_SECONDS', default: '0' },
  { name: 'Debounce (sec)', env: 'THUMBNAIL_DEBOUNCE_SECONDS', default: '5' },
];

for (const setting of perfSettings) {
  const value = process.env[setting.env] || setting.default;
  console.log(`${setting.name.padEnd(20)}: ${value}`);
}

// Server Configuration
console.log('\n🖥️  Server Configuration:');
console.log('─'.repeat(40));

const serverSettings = [
  { name: 'Port', env: 'PORT', default: '4001' },
  { name: 'Server Name', env: 'SERVER_NAME', default: 'RuneCortex Media Server' },
  { name: 'Database Path', env: 'DATABASE_PATH', default: './data/runecortex.db' },
];

for (const setting of serverSettings) {
  const value = process.env[setting.env] || setting.default;
  console.log(`${setting.name.padEnd(15)}: ${value}`);
}

// Feature Status
console.log('\n📊 Feature Status:');
console.log('─'.repeat(40));

const features = [
  { name: 'File Watcher', env: 'WATCHER_ENABLED', default: 'true' },
  { name: 'Perceptual Hash', env: 'PHASH_ENABLED', default: 'true' },
  { name: 'Location Services', env: 'LOCATION_SERVICES_ENABLED', default: 'false' },
];

for (const feature of features) {
  const value = process.env[feature.env] || feature.default;
  const enabled = value !== 'false';
  console.log(`${enabled ? '✅' : '❌'} ${feature.name}`);
}

console.log('\n💡 Tips:');
console.log('─'.repeat(40));
console.log('• To disable a plugin, set its environment variable to "false"');
console.log('• Performance settings can be tuned based on your hardware');
console.log('• Check the README.md for detailed configuration options');
console.log('');