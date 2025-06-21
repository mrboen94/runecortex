import { db, schema } from '../db';
import { eq, and, inArray, isNull } from 'drizzle-orm';
import { tagService } from './tagService';
import { $ } from 'bun';
import path from 'path';

interface TagRule {
  id: string;
  name: string;
  enabled: boolean;
  priority: number;
  conditions: TagCondition[];
  tags: string[];
}

interface TagCondition {
  type: 'filename' | 'path' | 'date' | 'metadata' | 'content' | 'location';
  operator: 'contains' | 'matches' | 'startsWith' | 'endsWith' | 'equals' | 'between';
  value: string | string[] | number[];
  caseSensitive?: boolean;
}

interface LocationData {
  latitude: number;
  longitude: number;
  city?: string;
  country?: string;
  landmark?: string;
}

export class AutoTaggingService {
  private rules: TagRule[] = [];
  private locationCache = new Map<string, LocationData>();
  private contentAnalysisEnabled = false;
  
  constructor() {
    this.initializeDefaultRules();
  }

  private initializeDefaultRules() {
    this.rules = [
      // Date-based rules
      {
        id: 'year-tags',
        name: 'Year Tags',
        enabled: true,
        priority: 100,
        conditions: [{
          type: 'date',
          operator: 'matches',
          value: '(\\d{4})'
        }],
        tags: ['$1'] // Dynamic tag from regex capture
      },
      {
        id: 'season-tags',
        name: 'Season Tags',
        enabled: true,
        priority: 90,
        conditions: [{
          type: 'date',
          operator: 'between',
          value: [] // Will be evaluated dynamically
        }],
        tags: [] // Will be set based on month
      },
      
      // Filename pattern rules
      {
        id: 'vacation-photos',
        name: 'Vacation Photos',
        enabled: true,
        priority: 80,
        conditions: [{
          type: 'filename',
          operator: 'matches',
          value: '(vacation|holiday|trip|travel)',
          caseSensitive: false
        }],
        tags: ['vacation', 'travel']
      },
      {
        id: 'screenshots',
        name: 'Screenshots',
        enabled: true,
        priority: 70,
        conditions: [{
          type: 'filename',
          operator: 'matches',
          value: '(screenshot|screen.?shot|screen.?capture)',
          caseSensitive: false
        }],
        tags: ['screenshot']
      },
      {
        id: 'selfies',
        name: 'Selfies',
        enabled: true,
        priority: 70,
        conditions: [{
          type: 'filename',
          operator: 'contains',
          value: 'selfie',
          caseSensitive: false
        }],
        tags: ['selfie', 'portrait']
      },
      
      // Path-based rules
      {
        id: 'downloads',
        name: 'Downloads',
        enabled: true,
        priority: 60,
        conditions: [{
          type: 'path',
          operator: 'contains',
          value: '/Downloads/',
          caseSensitive: false
        }],
        tags: ['downloads']
      },
      {
        id: 'whatsapp',
        name: 'WhatsApp Media',
        enabled: true,
        priority: 60,
        conditions: [{
          type: 'path',
          operator: 'contains',
          value: 'WhatsApp',
          caseSensitive: false
        }],
        tags: ['whatsapp', 'messaging']
      },
      
      // Camera-specific rules
      {
        id: 'iphone-photos',
        name: 'iPhone Photos',
        enabled: true,
        priority: 50,
        conditions: [{
          type: 'filename',
          operator: 'matches',
          value: '^IMG_\\d{4}',
          caseSensitive: true
        }],
        tags: ['iphone', 'mobile']
      },
      {
        id: 'dslr-photos',
        name: 'DSLR Photos',
        enabled: true,
        priority: 50,
        conditions: [{
          type: 'filename',
          operator: 'matches',
          value: '^(DSC|_DSC|IMG)_?\\d{4}',
          caseSensitive: true
        }],
        tags: ['dslr', 'camera']
      },
      
      // Event detection
      {
        id: 'birthday',
        name: 'Birthday',
        enabled: true,
        priority: 40,
        conditions: [{
          type: 'filename',
          operator: 'matches',
          value: 'birthday|bday|cake',
          caseSensitive: false
        }],
        tags: ['birthday', 'celebration', 'event']
      },
      {
        id: 'wedding',
        name: 'Wedding',
        enabled: true,
        priority: 40,
        conditions: [{
          type: 'filename',
          operator: 'matches',
          value: 'wedding|marriage|ceremony',
          caseSensitive: false
        }],
        tags: ['wedding', 'celebration', 'event']
      },
      {
        id: 'christmas',
        name: 'Christmas',
        enabled: true,
        priority: 40,
        conditions: [{
          type: 'filename',
          operator: 'matches',
          value: 'christmas|xmas|santa',
          caseSensitive: false
        }],
        tags: ['christmas', 'holiday', 'event']
      }
    ];
  }

  async autoTagMedia(mediaId: number): Promise<string[]> {
    const media = await db.select()
      .from(schema.mediaItems)
      .where(eq(schema.mediaItems.id, mediaId))
      .limit(1);
    
    if (media.length === 0) return [];
    
    const item = media[0];
    const appliedTags = new Set<string>();
    
    // Sort rules by priority (higher first)
    const sortedRules = [...this.rules]
      .filter(rule => rule.enabled)
      .sort((a, b) => b.priority - a.priority);
    
    for (const rule of sortedRules) {
      if (await this.evaluateRule(rule, item)) {
        for (const tag of rule.tags) {
          // Handle dynamic tags (e.g., year from date)
          const processedTag = await this.processDynamicTag(tag, item);
          if (processedTag) {
            appliedTags.add(processedTag.toLowerCase());
          }
        }
      }
    }
    
    // Apply location-based tags if available
    if (this.contentAnalysisEnabled) {
      const locationTags = await this.getLocationTags(item);
      locationTags.forEach(tag => appliedTags.add(tag.toLowerCase()));
    }
    
    // Apply content-based tags
    const contentTags = await this.analyzeContent(item);
    contentTags.forEach(tag => appliedTags.add(tag.toLowerCase()));
    
    // Apply the tags
    const tagArray = Array.from(appliedTags);
    if (tagArray.length > 0) {
      await tagService.autoTagMedia(mediaId, tagArray);
    }
    
    return tagArray;
  }

  private async evaluateRule(rule: TagRule, item: schema.MediaItem): Promise<boolean> {
    for (const condition of rule.conditions) {
      if (!await this.evaluateCondition(condition, item)) {
        return false;
      }
    }
    return true;
  }

  private async evaluateCondition(condition: TagCondition, item: schema.MediaItem): Promise<boolean> {
    const value = condition.value;
    
    switch (condition.type) {
      case 'filename':
        return this.evaluateStringCondition(item.filename, condition);
      
      case 'path':
        return this.evaluateStringCondition(item.filepath, condition);
      
      case 'date':
        return this.evaluateDateCondition(item.createdAt, condition);
      
      case 'metadata':
        return this.evaluateMetadataCondition(item, condition);
      
      case 'content':
        return await this.evaluateContentCondition(item, condition);
      
      case 'location':
        return await this.evaluateLocationCondition(item, condition);
      
      default:
        return false;
    }
  }

  private evaluateStringCondition(str: string, condition: TagCondition): boolean {
    const value = condition.value as string;
    const testStr = condition.caseSensitive ? str : str.toLowerCase();
    const testValue = condition.caseSensitive ? value : value.toLowerCase();
    
    switch (condition.operator) {
      case 'contains':
        return testStr.includes(testValue);
      case 'matches':
        try {
          const regex = new RegExp(value, condition.caseSensitive ? 'g' : 'gi');
          return regex.test(str);
        } catch {
          return false;
        }
      case 'startsWith':
        return testStr.startsWith(testValue);
      case 'endsWith':
        return testStr.endsWith(testValue);
      case 'equals':
        return testStr === testValue;
      default:
        return false;
    }
  }

  private evaluateDateCondition(date: Date, condition: TagCondition): boolean {
    const month = date.getMonth();
    
    // Special handling for season detection
    if (condition.operator === 'between' && condition.value.length === 0) {
      // This is a season rule, it will be handled differently
      return true;
    }
    
    if (condition.operator === 'matches' && typeof condition.value === 'string') {
      // Extract year or other date components
      const regex = new RegExp(condition.value);
      const dateStr = date.toISOString();
      return regex.test(dateStr);
    }
    
    return false;
  }

  private evaluateMetadataCondition(item: schema.MediaItem, condition: TagCondition): boolean {
    if (!item.metadataJson) return false;
    
    try {
      const metadata = JSON.parse(item.metadataJson);
      // Implement metadata-based conditions (e.g., camera model, ISO, etc.)
      return false;
    } catch {
      return false;
    }
  }

  private async evaluateContentCondition(item: schema.MediaItem, condition: TagCondition): Promise<boolean> {
    // This would integrate with content analysis APIs
    return false;
  }

  private async evaluateLocationCondition(item: schema.MediaItem, condition: TagCondition): Promise<boolean> {
    const location = await this.extractLocation(item);
    if (!location) return false;
    
    // Implement location-based conditions
    return false;
  }

  private async processDynamicTag(tag: string, item: schema.MediaItem): Promise<string | null> {
    // Handle regex capture groups (e.g., $1)
    if (tag.startsWith('$')) {
      return null; // This would be handled by the regex evaluation
    }
    
    // Handle special tags
    if (tag === 'season') {
      return this.getSeasonTag(item.createdAt);
    }
    
    // Handle year extraction
    if (tag.includes('year')) {
      return item.createdAt.getFullYear().toString();
    }
    
    return tag;
  }

  private getSeasonTag(date: Date): string {
    const month = date.getMonth();
    
    if (month >= 2 && month <= 4) return 'spring';
    if (month >= 5 && month <= 7) return 'summer';
    if (month >= 8 && month <= 10) return 'autumn';
    return 'winter';
  }

  private async analyzeContent(item: schema.MediaItem): Promise<string[]> {
    const tags: string[] = [];
    
    // Analyze based on file properties
    if (item.width && item.height) {
      const aspectRatio = item.width / item.height;
      
      // Orientation tags
      if (aspectRatio > 1.2) {
        tags.push('landscape');
      } else if (aspectRatio < 0.8) {
        tags.push('portrait');
      } else {
        tags.push('square');
      }
      
      // Resolution tags
      if (item.width >= 3840) {
        tags.push('4k', 'high-resolution');
      } else if (item.width >= 1920) {
        tags.push('hd', 'full-hd');
      }
      
      // Special aspect ratios
      if (Math.abs(aspectRatio - 16/9) < 0.1) {
        tags.push('16:9', 'widescreen');
      } else if (Math.abs(aspectRatio - 1) < 0.1) {
        tags.push('1:1', 'instagram');
      } else if (Math.abs(aspectRatio - 9/16) < 0.1) {
        tags.push('9:16', 'vertical', 'stories');
      }
    }
    
    // Video-specific tags
    if (item.fileType === 'video' && item.duration) {
      if (item.duration < 60) {
        tags.push('short-video', 'clip');
      } else if (item.duration < 300) {
        tags.push('medium-video');
      } else {
        tags.push('long-video');
      }
      
      // Detect slow motion or timelapse based on filename
      if (item.filename.toLowerCase().includes('slow') || 
          item.filename.toLowerCase().includes('slomo')) {
        tags.push('slow-motion');
      }
      if (item.filename.toLowerCase().includes('timelapse') || 
          item.filename.toLowerCase().includes('time-lapse')) {
        tags.push('timelapse');
      }
    }
    
    // File type tags
    const ext = path.extname(item.filename).toLowerCase();
    switch (ext) {
      case '.gif':
        tags.push('gif', 'animation');
        break;
      case '.png':
        tags.push('png', 'transparent');
        break;
      case '.raw':
      case '.dng':
      case '.cr2':
      case '.nef':
      case '.arw':
        tags.push('raw', 'professional');
        break;
    }
    
    return tags;
  }

  private async extractLocation(item: schema.MediaItem): Promise<LocationData | null> {
    if (!item.metadataJson) return null;
    
    try {
      const metadata = JSON.parse(item.metadataJson);
      
      // Check for GPS data in metadata
      if (metadata.GPSLatitude && metadata.GPSLongitude) {
        const lat = this.convertGPSToDecimal(metadata.GPSLatitude, metadata.GPSLatitudeRef);
        const lon = this.convertGPSToDecimal(metadata.GPSLongitude, metadata.GPSLongitudeRef);
        
        if (lat && lon) {
          // Cache and reverse geocode
          const cacheKey = `${lat.toFixed(3)},${lon.toFixed(3)}`;
          if (this.locationCache.has(cacheKey)) {
            return this.locationCache.get(cacheKey)!;
          }
          
          const location: LocationData = {
            latitude: lat,
            longitude: lon
          };
          
          // Here you would call a reverse geocoding service
          // For now, we'll just return the coordinates
          
          this.locationCache.set(cacheKey, location);
          return location;
        }
      }
    } catch {
      // Ignore errors
    }
    
    return null;
  }

  private convertGPSToDecimal(gps: any, ref: string): number | null {
    try {
      if (Array.isArray(gps) && gps.length >= 3) {
        let decimal = gps[0] + gps[1] / 60 + gps[2] / 3600;
        if (ref === 'S' || ref === 'W') {
          decimal = -decimal;
        }
        return decimal;
      }
    } catch {
      // Ignore errors
    }
    return null;
  }

  private async getLocationTags(item: schema.MediaItem): Promise<string[]> {
    const location = await this.extractLocation(item);
    if (!location) return [];
    
    const tags: string[] = ['geotagged'];
    
    if (location.city) tags.push(location.city.toLowerCase());
    if (location.country) tags.push(location.country.toLowerCase());
    if (location.landmark) tags.push(location.landmark.toLowerCase());
    
    return tags;
  }

  async addCustomRule(rule: Omit<TagRule, 'id'>): Promise<void> {
    const newRule: TagRule = {
      ...rule,
      id: `custom-${Date.now()}`
    };
    this.rules.push(newRule);
  }

  async removeRule(ruleId: string): Promise<void> {
    this.rules = this.rules.filter(rule => rule.id !== ruleId);
  }

  async updateRule(ruleId: string, updates: Partial<TagRule>): Promise<void> {
    const index = this.rules.findIndex(rule => rule.id === ruleId);
    if (index >= 0) {
      this.rules[index] = { ...this.rules[index], ...updates };
    }
  }

  getRules(): TagRule[] {
    return [...this.rules];
  }

  async processUntaggedMedia(limit: number = 100): Promise<number> {
    // Find media without tags
    const untaggedMedia = await db.select()
      .from(schema.mediaItems)
      .leftJoin(schema.mediaTags, eq(schema.mediaItems.id, schema.mediaTags.mediaId))
      .where(isNull(schema.mediaTags.mediaId))
      .limit(limit);
    
    let processed = 0;
    
    for (const item of untaggedMedia) {
      if (item.media_items) {
        const tags = await this.autoTagMedia(item.media_items.id);
        if (tags.length > 0) {
          processed++;
        }
      }
    }
    
    return processed;
  }

  async generateSmartTags(mediaId: number): Promise<string[]> {
    const media = await db.select()
      .from(schema.mediaItems)
      .where(eq(schema.mediaItems.id, mediaId))
      .limit(1);
    
    if (media.length === 0) return [];
    
    const item = media[0];
    const smartTags: string[] = [];
    
    // Time-based smart tags
    const hour = item.createdAt.getHours();
    if (hour >= 5 && hour < 12) {
      smartTags.push('morning');
    } else if (hour >= 12 && hour < 17) {
      smartTags.push('afternoon');
    } else if (hour >= 17 && hour < 21) {
      smartTags.push('evening');
    } else {
      smartTags.push('night');
    }
    
    // Day of week
    const dayNames = ['sunday', 'monday', 'tuesday', 'wednesday', 'thursday', 'friday', 'saturday'];
    smartTags.push(dayNames[item.createdAt.getDay()]);
    
    // Weekend/weekday
    if (item.createdAt.getDay() === 0 || item.createdAt.getDay() === 6) {
      smartTags.push('weekend');
    } else {
      smartTags.push('weekday');
    }
    
    // Month name
    const monthNames = ['january', 'february', 'march', 'april', 'may', 'june',
                       'july', 'august', 'september', 'october', 'november', 'december'];
    smartTags.push(monthNames[item.createdAt.getMonth()]);
    
    // Detect burst photos (multiple photos within seconds)
    const burstWindow = 5; // seconds
    const similarTime = await db.select()
      .from(schema.mediaItems)
      .where(and(
        eq(schema.mediaItems.fileType, item.fileType),
        // Check for items within burst window
        schema.mediaItems.createdAt >= new Date(item.createdAt.getTime() - burstWindow * 1000),
        schema.mediaItems.createdAt <= new Date(item.createdAt.getTime() + burstWindow * 1000),
        schema.mediaItems.id !== item.id
      ));
    
    if (similarTime.length >= 3) {
      smartTags.push('burst', 'series');
    }
    
    return smartTags;
  }
}

export const autoTaggingService = new AutoTaggingService();