import fs from 'fs/promises';
import path from 'path';
import os from 'os';

interface UIPreferences {
  theme: 'light' | 'dark' | 'auto';
  language: string;
  dateFormat: string;
  timeFormat: '12h' | '24h';
  defaultView: 'timeline' | 'year' | 'month' | 'day';
  itemsPerPage: number;
  showHiddenFiles: boolean;
  showThumbnails: boolean;
  thumbnailSize: 'small' | 'medium' | 'large';
  sidebarCollapsed: boolean;
  defaultTab: string;
}

interface MediaPreferences {
  videoPlayer: 'default' | 'vlc' | 'mpv';
  imageViewer: 'default' | 'external';
  autoplayVideos: boolean;
  muteByDefault: boolean;
  loopVideos: boolean;
  skipDuration: number; // seconds
  volumeLevel: number; // 0-100
  subtitlesEnabled: boolean;
  defaultQuality: 'auto' | 'original' | '1080p' | '720p';
}

interface ScannerPreferences {
  autoScan: boolean;
  scanInterval: number; // minutes
  excludePatterns: string[];
  includeHidden: boolean;
  followSymlinks: boolean;
  generateThumbnails: boolean;
  generatePhashes: boolean;
  videoThumbnailPosition: number; // percentage
  maxFileSize: number; // MB
  supportedImageFormats: string[];
  supportedVideoFormats: string[];
}

interface PrivacyPreferences {
  blurNSFW: boolean;
  requireConfirmDelete: boolean;
  enableActivityLog: boolean;
  clearActivityOnExit: boolean;
  anonymousUsage: boolean;
}

interface PerformancePreferences {
  maxConcurrentScans: number;
  maxConcurrentThumbnails: number;
  thumbnailQuality: number; // 1-100
  cacheSize: number; // MB
  preloadCount: number;
  enableHardwareAcceleration: boolean;
  databaseOptimizeInterval: number; // days
}

interface BackupPreferences {
  autoBackup: boolean;
  backupInterval: number; // days
  backupLocation: string;
  maxBackups: number;
  includeMediaInBackup: boolean;
  compressBackups: boolean;
}

export interface UserPreferences {
  ui: UIPreferences;
  media: MediaPreferences;
  scanner: ScannerPreferences;
  privacy: PrivacyPreferences;
  performance: PerformancePreferences;
  backup: BackupPreferences;
  customSettings: Record<string, any>;
}

export class PreferencesService {
  private readonly preferencesPath: string;
  private preferences: UserPreferences;
  private readonly defaultPreferences: UserPreferences = {
    ui: {
      theme: 'auto',
      language: 'en',
      dateFormat: 'YYYY-MM-DD',
      timeFormat: '24h',
      defaultView: 'timeline',
      itemsPerPage: 50,
      showHiddenFiles: false,
      showThumbnails: true,
      thumbnailSize: 'medium',
      sidebarCollapsed: false,
      defaultTab: 'media',
    },
    media: {
      videoPlayer: 'default',
      imageViewer: 'default',
      autoplayVideos: false,
      muteByDefault: true,
      loopVideos: false,
      skipDuration: 10,
      volumeLevel: 70,
      subtitlesEnabled: true,
      defaultQuality: 'auto',
    },
    scanner: {
      autoScan: true,
      scanInterval: 60,
      excludePatterns: [
        '*.tmp',
        '*.temp',
        '.DS_Store',
        'Thumbs.db',
        '.*',
      ],
      includeHidden: false,
      followSymlinks: false,
      generateThumbnails: true,
      generatePhashes: true,
      videoThumbnailPosition: 10,
      maxFileSize: 5000, // 5GB
      supportedImageFormats: [
        'jpg', 'jpeg', 'png', 'gif', 'webp', 'bmp', 'tiff', 'svg',
        'heic', 'heif', 'raw', 'cr2', 'nef', 'arw', 'dng',
      ],
      supportedVideoFormats: [
        'mp4', 'avi', 'mkv', 'mov', 'wmv', 'flv', 'webm', 'm4v',
        'mpg', 'mpeg', '3gp', 'ogv', 'ts', 'm2ts', 'mts',
      ],
    },
    privacy: {
      blurNSFW: false,
      requireConfirmDelete: true,
      enableActivityLog: true,
      clearActivityOnExit: false,
      anonymousUsage: true,
    },
    performance: {
      maxConcurrentScans: 2,
      maxConcurrentThumbnails: 4,
      thumbnailQuality: 85,
      cacheSize: 500,
      preloadCount: 5,
      enableHardwareAcceleration: true,
      databaseOptimizeInterval: 7,
    },
    backup: {
      autoBackup: false,
      backupInterval: 7,
      backupLocation: path.join(os.homedir(), 'RuneCortex', 'backups'),
      maxBackups: 5,
      includeMediaInBackup: false,
      compressBackups: true,
    },
    customSettings: {},
  };

  constructor(configPath?: string) {
    this.preferencesPath = configPath || path.join(
      os.homedir(),
      '.runecortex',
      'preferences.json'
    );
    this.preferences = { ...this.defaultPreferences };
  }

  async initialize(): Promise<void> {
    try {
      await this.load();
    } catch (error) {
      // If preferences don't exist, create with defaults
      await this.save();
    }
  }

  async load(): Promise<void> {
    const data = await fs.readFile(this.preferencesPath, 'utf-8');
    const loaded = JSON.parse(data);
    
    // Deep merge with defaults to ensure all properties exist
    this.preferences = this.deepMerge(this.defaultPreferences, loaded);
  }

  async save(): Promise<void> {
    const dir = path.dirname(this.preferencesPath);
    await fs.mkdir(dir, { recursive: true });
    
    const data = JSON.stringify(this.preferences, null, 2);
    await fs.writeFile(this.preferencesPath, data, 'utf-8');
  }

  get<K extends keyof UserPreferences>(category: K): UserPreferences[K] {
    return this.preferences[category];
  }

  async set<K extends keyof UserPreferences>(
    category: K,
    preferences: Partial<UserPreferences[K]>
  ): Promise<void> {
    this.preferences[category] = {
      ...this.preferences[category],
      ...preferences,
    };
    await this.save();
  }

  async setCustom(key: string, value: any): Promise<void> {
    this.preferences.customSettings[key] = value;
    await this.save();
  }

  getCustom(key: string): any {
    return this.preferences.customSettings[key];
  }

  async reset(category?: keyof UserPreferences): Promise<void> {
    if (category) {
      this.preferences[category] = { ...this.defaultPreferences[category] };
    } else {
      this.preferences = { ...this.defaultPreferences };
    }
    await this.save();
  }

  getAll(): UserPreferences {
    return { ...this.preferences };
  }

  async import(preferences: Partial<UserPreferences>): Promise<void> {
    this.preferences = this.deepMerge(this.preferences, preferences);
    await this.save();
  }

  async export(): Promise<UserPreferences> {
    return { ...this.preferences };
  }

  // Preference helpers
  getTheme(): UIPreferences['theme'] {
    return this.preferences.ui.theme;
  }

  async setTheme(theme: UIPreferences['theme']): Promise<void> {
    await this.set('ui', { theme });
  }

  getItemsPerPage(): number {
    return this.preferences.ui.itemsPerPage;
  }

  async setItemsPerPage(count: number): Promise<void> {
    await this.set('ui', { itemsPerPage: count });
  }

  getThumbnailSize(): UIPreferences['thumbnailSize'] {
    return this.preferences.ui.thumbnailSize;
  }

  async setThumbnailSize(size: UIPreferences['thumbnailSize']): Promise<void> {
    await this.set('ui', { thumbnailSize: size });
  }

  getScannerSettings(): ScannerPreferences {
    return { ...this.preferences.scanner };
  }

  async updateScannerSettings(settings: Partial<ScannerPreferences>): Promise<void> {
    await this.set('scanner', settings);
  }

  getPerformanceSettings(): PerformancePreferences {
    return { ...this.preferences.performance };
  }

  async updatePerformanceSettings(settings: Partial<PerformancePreferences>): Promise<void> {
    await this.set('performance', settings);
  }

  // Validation helpers
  validatePreferences(preferences: any): boolean {
    // Add validation logic here
    return true;
  }

  // Migration for older preference formats
  async migrate(fromVersion: string): Promise<void> {
    // Handle preference migration between versions
  }

  private deepMerge(target: any, source: any): any {
    const output = { ...target };
    
    if (this.isObject(target) && this.isObject(source)) {
      Object.keys(source).forEach(key => {
        if (this.isObject(source[key])) {
          if (!(key in target)) {
            Object.assign(output, { [key]: source[key] });
          } else {
            output[key] = this.deepMerge(target[key], source[key]);
          }
        } else {
          Object.assign(output, { [key]: source[key] });
        }
      });
    }
    
    return output;
  }

  private isObject(item: any): boolean {
    return item && typeof item === 'object' && !Array.isArray(item);
  }

  // Get environment-based defaults
  async detectSystemPreferences(): Promise<Partial<UserPreferences>> {
    const detected: Partial<UserPreferences> = {};
    
    // Detect system theme preference
    if (process.platform === 'darwin') {
      // macOS-specific detection
      try {
        const { execSync } = require('child_process');
        const output = execSync('defaults read -g AppleInterfaceStyle 2>/dev/null || echo "Light"')
          .toString()
          .trim();
        detected.ui = {
          theme: output === 'Dark' ? 'dark' : 'light',
        };
      } catch {}
    }
    
    // Detect system language
    const systemLocale = Intl.DateTimeFormat().resolvedOptions().locale;
    if (detected.ui) {
      detected.ui.language = systemLocale.split('-')[0];
    } else {
      detected.ui = { language: systemLocale.split('-')[0] };
    }
    
    return detected;
  }
}

export const preferencesService = new PreferencesService();