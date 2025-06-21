import fs from 'fs/promises';
import path from 'path';
import { EventEmitter } from 'events';
import vm from 'vm';

export interface PluginManifest {
  id: string;
  name: string;
  version: string;
  description: string;
  author: string;
  homepage?: string;
  repository?: string;
  main: string;
  ui?: {
    settings?: string;
    tabs?: Array<{
      id: string;
      name: string;
      component: string;
    }>;
  };
  permissions: string[];
  dependencies?: Record<string, string>;
  engines?: {
    runecortex: string;
  };
}

export interface PluginContext {
  // Core services exposed to plugins
  services: {
    media: any;
    tags: any;
    collections: any;
    filters: any;
    preferences: any;
  };
  
  // Plugin storage
  storage: {
    get(key: string): Promise<any>;
    set(key: string, value: any): Promise<void>;
    delete(key: string): Promise<void>;
    clear(): Promise<void>;
  };
  
  // Event system
  events: EventEmitter;
  
  // UI integration
  ui: {
    registerTab(tab: any): void;
    registerSettings(component: any): void;
    showNotification(message: string, type?: 'info' | 'success' | 'warning' | 'error'): void;
  };
  
  // Utilities
  utils: {
    log(...args: any[]): void;
    error(...args: any[]): void;
    fetch(url: string, options?: any): Promise<Response>;
  };
}

export abstract class Plugin {
  protected context: PluginContext;
  protected manifest: PluginManifest;
  
  constructor(context: PluginContext, manifest: PluginManifest) {
    this.context = context;
    this.manifest = manifest;
  }
  
  abstract onLoad(): Promise<void>;
  abstract onUnload(): Promise<void>;
  
  // Optional lifecycle hooks
  onEnable?(): Promise<void>;
  onDisable?(): Promise<void>;
  onUpdate?(fromVersion: string): Promise<void>;
  
  // Event handlers
  onMediaAdded?(media: any): Promise<void>;
  onMediaUpdated?(media: any): Promise<void>;
  onMediaDeleted?(mediaId: number): Promise<void>;
  onScanStarted?(path: string): Promise<void>;
  onScanCompleted?(result: any): Promise<void>;
  onThumbnailGenerated?(mediaId: number): Promise<void>;
}

export class PluginManager {
  private plugins: Map<string, {
    manifest: PluginManifest;
    instance: Plugin;
    enabled: boolean;
    path: string;
  }> = new Map();
  
  private events: EventEmitter = new EventEmitter();
  private pluginsPath: string;
  private storagePath: string;
  
  constructor(pluginsPath: string) {
    this.pluginsPath = pluginsPath;
    this.storagePath = path.join(pluginsPath, '.storage');
  }
  
  async initialize(): Promise<void> {
    // Create plugins directory if it doesn't exist
    await fs.mkdir(this.pluginsPath, { recursive: true });
    await fs.mkdir(this.storagePath, { recursive: true });
    
    // Load all plugins
    await this.discoverPlugins();
  }
  
  async discoverPlugins(): Promise<void> {
    const entries = await fs.readdir(this.pluginsPath, { withFileTypes: true });
    
    for (const entry of entries) {
      if (entry.isDirectory() && !entry.name.startsWith('.')) {
        const pluginPath = path.join(this.pluginsPath, entry.name);
        try {
          await this.loadPlugin(pluginPath);
        } catch (error) {
          console.error(`Failed to load plugin from ${pluginPath}:`, error);
        }
      }
    }
  }
  
  async loadPlugin(pluginPath: string): Promise<void> {
    // Read manifest
    const manifestPath = path.join(pluginPath, 'manifest.json');
    const manifestData = await fs.readFile(manifestPath, 'utf-8');
    const manifest: PluginManifest = JSON.parse(manifestData);
    
    // Validate manifest
    this.validateManifest(manifest);
    
    // Check if plugin already loaded
    if (this.plugins.has(manifest.id)) {
      throw new Error(`Plugin ${manifest.id} is already loaded`);
    }
    
    // Check permissions
    this.checkPermissions(manifest.permissions);
    
    // Create plugin context
    const context = this.createPluginContext(manifest.id);
    
    // Load plugin module
    const mainPath = path.join(pluginPath, manifest.main);
    const PluginClass = await this.loadPluginModule(mainPath);
    
    // Create instance
    const instance = new PluginClass(context, manifest);
    
    // Store plugin
    this.plugins.set(manifest.id, {
      manifest,
      instance,
      enabled: false,
      path: pluginPath,
    });
    
    // Load plugin
    await instance.onLoad();
    
    console.log(`Loaded plugin: ${manifest.name} v${manifest.version}`);
  }
  
  async enablePlugin(pluginId: string): Promise<void> {
    const plugin = this.plugins.get(pluginId);
    if (!plugin) {
      throw new Error(`Plugin ${pluginId} not found`);
    }
    
    if (plugin.enabled) {
      return;
    }
    
    // Enable plugin
    if (plugin.instance.onEnable) {
      await plugin.instance.onEnable();
    }
    
    plugin.enabled = true;
    
    // Register event handlers
    this.registerPluginEvents(pluginId, plugin.instance);
  }
  
  async disablePlugin(pluginId: string): Promise<void> {
    const plugin = this.plugins.get(pluginId);
    if (!plugin) {
      throw new Error(`Plugin ${pluginId} not found`);
    }
    
    if (!plugin.enabled) {
      return;
    }
    
    // Unregister event handlers
    this.unregisterPluginEvents(pluginId);
    
    // Disable plugin
    if (plugin.instance.onDisable) {
      await plugin.instance.onDisable();
    }
    
    plugin.enabled = false;
  }
  
  async unloadPlugin(pluginId: string): Promise<void> {
    const plugin = this.plugins.get(pluginId);
    if (!plugin) {
      throw new Error(`Plugin ${pluginId} not found`);
    }
    
    // Disable first
    if (plugin.enabled) {
      await this.disablePlugin(pluginId);
    }
    
    // Unload plugin
    await plugin.instance.onUnload();
    
    // Remove from registry
    this.plugins.delete(pluginId);
  }
  
  async reloadPlugin(pluginId: string): Promise<void> {
    const plugin = this.plugins.get(pluginId);
    if (!plugin) {
      throw new Error(`Plugin ${pluginId} not found`);
    }
    
    const wasEnabled = plugin.enabled;
    const pluginPath = plugin.path;
    
    // Unload plugin
    await this.unloadPlugin(pluginId);
    
    // Reload plugin
    await this.loadPlugin(pluginPath);
    
    // Re-enable if it was enabled
    if (wasEnabled) {
      await this.enablePlugin(pluginId);
    }
  }
  
  getPlugin(pluginId: string): Plugin | undefined {
    return this.plugins.get(pluginId)?.instance;
  }
  
  getAllPlugins(): Array<{
    id: string;
    manifest: PluginManifest;
    enabled: boolean;
  }> {
    return Array.from(this.plugins.entries()).map(([id, plugin]) => ({
      id,
      manifest: plugin.manifest,
      enabled: plugin.enabled,
    }));
  }
  
  // Event emission for plugins
  async emit(event: string, ...args: any[]): Promise<void> {
    this.events.emit(event, ...args);
    
    // Call specific plugin methods
    for (const [id, plugin] of this.plugins) {
      if (!plugin.enabled) continue;
      
      try {
        switch (event) {
          case 'media:added':
            if (plugin.instance.onMediaAdded) {
              await plugin.instance.onMediaAdded(args[0]);
            }
            break;
          case 'media:updated':
            if (plugin.instance.onMediaUpdated) {
              await plugin.instance.onMediaUpdated(args[0]);
            }
            break;
          case 'media:deleted':
            if (plugin.instance.onMediaDeleted) {
              await plugin.instance.onMediaDeleted(args[0]);
            }
            break;
          case 'scan:started':
            if (plugin.instance.onScanStarted) {
              await plugin.instance.onScanStarted(args[0]);
            }
            break;
          case 'scan:completed':
            if (plugin.instance.onScanCompleted) {
              await plugin.instance.onScanCompleted(args[0]);
            }
            break;
          case 'thumbnail:generated':
            if (plugin.instance.onThumbnailGenerated) {
              await plugin.instance.onThumbnailGenerated(args[0]);
            }
            break;
        }
      } catch (error) {
        console.error(`Plugin ${id} error handling event ${event}:`, error);
      }
    }
  }
  
  private createPluginContext(pluginId: string): PluginContext {
    const storagePath = path.join(this.storagePath, pluginId);
    
    return {
      services: {
        // These would be injected from the main app
        media: null,
        tags: null,
        collections: null,
        filters: null,
        preferences: null,
      },
      
      storage: {
        get: async (key: string) => {
          try {
            const data = await fs.readFile(path.join(storagePath, `${key}.json`), 'utf-8');
            return JSON.parse(data);
          } catch {
            return null;
          }
        },
        
        set: async (key: string, value: any) => {
          await fs.mkdir(storagePath, { recursive: true });
          await fs.writeFile(
            path.join(storagePath, `${key}.json`),
            JSON.stringify(value, null, 2)
          );
        },
        
        delete: async (key: string) => {
          try {
            await fs.unlink(path.join(storagePath, `${key}.json`));
          } catch {}
        },
        
        clear: async () => {
          try {
            await fs.rm(storagePath, { recursive: true });
          } catch {}
        },
      },
      
      events: this.events,
      
      ui: {
        registerTab: (tab: any) => {
          // Implementation would integrate with UI
          console.log(`Plugin ${pluginId} registered tab:`, tab);
        },
        
        registerSettings: (component: any) => {
          // Implementation would integrate with UI
          console.log(`Plugin ${pluginId} registered settings:`, component);
        },
        
        showNotification: (message: string, type = 'info') => {
          // Implementation would show UI notification
          console.log(`[${type.toUpperCase()}] ${pluginId}: ${message}`);
        },
      },
      
      utils: {
        log: (...args: any[]) => {
          console.log(`[Plugin ${pluginId}]`, ...args);
        },
        
        error: (...args: any[]) => {
          console.error(`[Plugin ${pluginId}]`, ...args);
        },
        
        fetch: async (url: string, options?: any) => {
          // Sandboxed fetch with plugin permissions
          return fetch(url, options);
        },
      },
    };
  }
  
  private validateManifest(manifest: PluginManifest): void {
    const required = ['id', 'name', 'version', 'description', 'author', 'main', 'permissions'];
    
    for (const field of required) {
      if (!(field in manifest)) {
        throw new Error(`Missing required field in manifest: ${field}`);
      }
    }
    
    // Validate ID format
    if (!/^[a-z0-9-]+$/.test(manifest.id)) {
      throw new Error('Plugin ID must contain only lowercase letters, numbers, and hyphens');
    }
    
    // Validate version format
    if (!/^\d+\.\d+\.\d+/.test(manifest.version)) {
      throw new Error('Version must follow semver format (e.g., 1.0.0)');
    }
  }
  
  private checkPermissions(permissions: string[]): void {
    const validPermissions = [
      'media:read',
      'media:write',
      'media:delete',
      'tags:read',
      'tags:write',
      'collections:read',
      'collections:write',
      'scan:trigger',
      'thumbnails:generate',
      'preferences:read',
      'preferences:write',
      'ui:tabs',
      'ui:settings',
      'network:fetch',
      'storage:unlimited',
    ];
    
    for (const permission of permissions) {
      if (!validPermissions.includes(permission)) {
        throw new Error(`Invalid permission: ${permission}`);
      }
    }
  }
  
  private async loadPluginModule(modulePath: string): Promise<typeof Plugin> {
    // In a real implementation, this would use a sandboxed environment
    // For now, we'll use a simple require
    const module = require(modulePath);
    return module.default || module;
  }
  
  private registerPluginEvents(pluginId: string, instance: Plugin): void {
    // Register generic event handlers
    const handlers = [
      'onMediaAdded',
      'onMediaUpdated',
      'onMediaDeleted',
      'onScanStarted',
      'onScanCompleted',
      'onThumbnailGenerated',
    ];
    
    for (const handler of handlers) {
      if ((instance as any)[handler]) {
        const eventName = handler.replace(/^on/, '').replace(/([A-Z])/g, ':$1').toLowerCase();
        this.events.on(eventName, (instance as any)[handler].bind(instance));
      }
    }
  }
  
  private unregisterPluginEvents(pluginId: string): void {
    // Remove all listeners for this plugin
    // In a real implementation, we'd track listeners per plugin
    this.events.removeAllListeners();
  }
}

// Example plugin implementation
export class ExamplePlugin extends Plugin {
  async onLoad(): Promise<void> {
    this.context.utils.log('Example plugin loaded!');
    
    // Set up initial storage
    await this.context.storage.set('config', {
      enabled: true,
      lastRun: new Date().toISOString(),
    });
  }
  
  async onUnload(): Promise<void> {
    this.context.utils.log('Example plugin unloaded!');
  }
  
  async onEnable(): Promise<void> {
    this.context.utils.log('Example plugin enabled!');
    this.context.ui.showNotification('Example plugin is now active', 'success');
  }
  
  async onDisable(): Promise<void> {
    this.context.utils.log('Example plugin disabled!');
  }
  
  async onMediaAdded(media: any): Promise<void> {
    this.context.utils.log('New media added:', media.filename);
    
    // Example: Auto-tag based on filename
    if (media.filename.includes('vacation')) {
      await this.context.services.tags.autoTagMedia(media.id, ['vacation']);
    }
  }
  
  async onScanCompleted(result: any): Promise<void> {
    this.context.utils.log('Scan completed:', result);
    
    // Save scan stats
    const stats = await this.context.storage.get('scanStats') || [];
    stats.push({
      date: new Date().toISOString(),
      filesProcessed: result.processed,
      newFiles: result.newFiles,
    });
    await this.context.storage.set('scanStats', stats);
  }
}