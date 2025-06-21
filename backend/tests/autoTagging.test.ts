import './test-env'; // Must be first import
import { describe, test, expect, beforeEach } from 'bun:test';
import { AutoTaggingService } from '../src/services/autoTaggingService';
import { db, schema } from '../src/db';
import { eq } from 'drizzle-orm';
import { cleanDatabase, insertTestMedia, insertTestTag } from './setup';

describe('AutoTaggingService', () => {
  let autoTagging: AutoTaggingService;

  beforeEach(async () => {
    await cleanDatabase();
    autoTagging = new AutoTaggingService();
  });

  describe('rule evaluation', () => {
    test('should apply year tags based on date', async () => {
      const media = await insertTestMedia({
        filename: 'photo.jpg',
        createdAt: new Date('2023-06-15')
      });

      const tags = await autoTagging.autoTagMedia(media.id);
      
      expect(tags).toContain('2023');
    });

    test('should apply season tags', async () => {
      const testCases = [
        { date: new Date('2023-03-15'), expectedSeason: 'spring' },
        { date: new Date('2023-06-15'), expectedSeason: 'summer' },
        { date: new Date('2023-09-15'), expectedSeason: 'autumn' },
        { date: new Date('2023-12-15'), expectedSeason: 'winter' }
      ];

      for (const testCase of testCases) {
        await cleanDatabase();
        
        const media = await insertTestMedia({
          filename: `seasonal-${testCase.expectedSeason}.jpg`,
          createdAt: testCase.date
        });

        const tags = await autoTagging.autoTagMedia(media.id);
        
        expect(tags).toContain(testCase.expectedSeason);
      }
    });

    test('should apply filename-based tags', async () => {
      const testCases = [
        { filename: 'vacation_photo.jpg', expectedTags: ['vacation', 'travel'] },
        { filename: 'Screenshot_2023.png', expectedTags: ['screenshot'] },
        { filename: 'selfie_beach.jpg', expectedTags: ['selfie', 'portrait'] },
        { filename: 'birthday_party.jpg', expectedTags: ['birthday', 'celebration', 'event'] },
        { filename: 'wedding_ceremony.jpg', expectedTags: ['wedding', 'celebration', 'event'] },
        { filename: 'christmas_morning.jpg', expectedTags: ['christmas', 'holiday', 'event'] }
      ];

      for (const testCase of testCases) {
        await cleanDatabase();
        
        const media = await insertTestMedia({
          filename: testCase.filename
        });

        const tags = await autoTagging.autoTagMedia(media.id);
        
        for (const expectedTag of testCase.expectedTags) {
          expect(tags).toContain(expectedTag);
        }
      }
    });

    test('should apply path-based tags', async () => {
      const testCases = [
        { path: '/Users/test/Downloads/photo.jpg', expectedTag: 'downloads' },
        { path: '/storage/WhatsApp/Images/IMG123.jpg', expectedTag: 'whatsapp' }
      ];

      for (const testCase of testCases) {
        await cleanDatabase();
        
        const media = await insertTestMedia({
          filepath: testCase.path,
          filename: 'test.jpg'
        });

        const tags = await autoTagging.autoTagMedia(media.id);
        
        expect(tags).toContain(testCase.expectedTag);
      }
    });

    test('should apply camera-specific tags', async () => {
      const testCases = [
        { filename: 'IMG_1234.jpg', expectedTag: 'iphone' },
        { filename: 'DSC_5678.jpg', expectedTag: 'dslr' },
        { filename: '_DSC9012.jpg', expectedTag: 'dslr' }
      ];

      for (const testCase of testCases) {
        await cleanDatabase();
        
        const media = await insertTestMedia({
          filename: testCase.filename
        });

        const tags = await autoTagging.autoTagMedia(media.id);
        
        expect(tags).toContain(testCase.expectedTag);
      }
    });

    test('should respect case sensitivity settings', async () => {
      const media = await insertTestMedia({
        filename: 'VACATION_Photo.JPG'
      });

      const tags = await autoTagging.autoTagMedia(media.id);
      
      expect(tags).toContain('vacation'); // Should match despite case
    });
  });

  describe('content-based tagging', () => {
    test('should tag based on orientation', async () => {
      const testCases = [
        { width: 1920, height: 1080, expectedTag: 'landscape' },
        { width: 1080, height: 1920, expectedTag: 'portrait' },
        { width: 1000, height: 1000, expectedTag: 'square' }
      ];

      for (const testCase of testCases) {
        await cleanDatabase();
        
        const media = await insertTestMedia({
          filename: `${testCase.expectedTag}.jpg`,
          width: testCase.width,
          height: testCase.height
        });

        const tags = await autoTagging.autoTagMedia(media.id);
        
        expect(tags).toContain(testCase.expectedTag);
      }
    });

    test('should tag based on resolution', async () => {
      const testCases = [
        { width: 3840, height: 2160, expectedTags: ['4k', 'high-resolution'] },
        { width: 1920, height: 1080, expectedTags: ['hd', 'full-hd'] },
        { width: 7680, height: 4320, expectedTags: ['4k', 'high-resolution'] } // 8K counts as 4k+
      ];

      for (const testCase of testCases) {
        await cleanDatabase();
        
        const media = await insertTestMedia({
          filename: 'resolution-test.jpg',
          width: testCase.width,
          height: testCase.height
        });

        const tags = await autoTagging.autoTagMedia(media.id);
        
        for (const expectedTag of testCase.expectedTags) {
          expect(tags).toContain(expectedTag);
        }
      }
    });

    test('should tag based on aspect ratio', async () => {
      const testCases = [
        { width: 1920, height: 1080, expectedTag: '16:9' },
        { width: 1000, height: 1000, expectedTag: '1:1' },
        { width: 1080, height: 1920, expectedTag: '9:16' }
      ];

      for (const testCase of testCases) {
        await cleanDatabase();
        
        const media = await insertTestMedia({
          filename: 'aspect-test.jpg',
          width: testCase.width,
          height: testCase.height
        });

        const tags = await autoTagging.autoTagMedia(media.id);
        
        expect(tags).toContain(testCase.expectedTag);
      }
    });

    test('should tag videos based on duration', async () => {
      const testCases = [
        { duration: 30, expectedTag: 'short-video' },
        { duration: 180, expectedTag: 'medium-video' },
        { duration: 600, expectedTag: 'long-video' }
      ];

      for (const testCase of testCases) {
        await cleanDatabase();
        
        const media = await insertTestMedia({
          filename: 'video.mp4',
          fileType: 'video',
          duration: testCase.duration
        });

        const tags = await autoTagging.autoTagMedia(media.id);
        
        expect(tags).toContain(testCase.expectedTag);
      }
    });

    test('should tag based on file type', async () => {
      const testCases = [
        { filename: 'animation.gif', expectedTags: ['gif', 'animation'] },
        { filename: 'transparent.png', expectedTags: ['png', 'transparent'] },
        { filename: 'photo.raw', expectedTags: ['raw', 'professional'] }
      ];

      for (const testCase of testCases) {
        await cleanDatabase();
        
        const media = await insertTestMedia({
          filename: testCase.filename
        });

        const tags = await autoTagging.autoTagMedia(media.id);
        
        for (const expectedTag of testCase.expectedTags) {
          expect(tags).toContain(expectedTag);
        }
      }
    });
  });

  describe('smart tagging', () => {
    test('should generate time-based smart tags', async () => {
      const testCases = [
        { hour: 8, expectedTag: 'morning' },
        { hour: 14, expectedTag: 'afternoon' },
        { hour: 19, expectedTag: 'evening' },
        { hour: 23, expectedTag: 'night' }
      ];

      for (const testCase of testCases) {
        await cleanDatabase();
        
        const date = new Date('2023-06-15');
        date.setHours(testCase.hour);
        
        const media = await insertTestMedia({
          filename: 'time-test.jpg',
          createdAt: date
        });

        const tags = await autoTagging.generateSmartTags(media.id);
        
        expect(tags).toContain(testCase.expectedTag);
      }
    });

    test('should generate day of week tags', async () => {
      const testCases = [
        { date: new Date('2023-06-18'), expectedTags: ['sunday', 'weekend'] },
        { date: new Date('2023-06-19'), expectedTags: ['monday', 'weekday'] },
        { date: new Date('2023-06-24'), expectedTags: ['saturday', 'weekend'] }
      ];

      for (const testCase of testCases) {
        await cleanDatabase();
        
        const media = await insertTestMedia({
          filename: 'day-test.jpg',
          createdAt: testCase.date
        });

        const tags = await autoTagging.generateSmartTags(media.id);
        
        for (const expectedTag of testCase.expectedTags) {
          expect(tags).toContain(expectedTag);
        }
      }
    });

    test('should detect burst photos', async () => {
      // Create multiple photos within burst window
      const baseTime = new Date('2023-06-15T10:00:00');
      
      for (let i = 0; i < 5; i++) {
        const time = new Date(baseTime.getTime() + i * 1000); // 1 second apart
        await insertTestMedia({
          filename: `burst${i}.jpg`,
          createdAt: time
        });
      }

      const media = await insertTestMedia({
        filename: 'burst-main.jpg',
        createdAt: new Date(baseTime.getTime() + 2000) // In the middle
      });

      const tags = await autoTagging.generateSmartTags(media.id);
      
      expect(tags).toContain('burst');
      expect(tags).toContain('series');
    });

    test('should add month name tags', async () => {
      const media = await insertTestMedia({
        filename: 'month-test.jpg',
        createdAt: new Date('2023-06-15')
      });

      const tags = await autoTagging.generateSmartTags(media.id);
      
      expect(tags).toContain('june');
    });
  });

  describe('rule management', () => {
    test('should add custom rules', async () => {
      const customRule = {
        name: 'Custom Rule',
        enabled: true,
        priority: 50,
        conditions: [{
          type: 'filename' as const,
          operator: 'contains' as const,
          value: 'custom'
        }],
        tags: ['custom-tag']
      };

      await autoTagging.addCustomRule(customRule);
      
      const rules = autoTagging.getRules();
      const addedRule = rules.find(r => r.name === 'Custom Rule');
      
      expect(addedRule).toBeTruthy();
      expect(addedRule?.tags).toContain('custom-tag');
    });

    test('should respect rule priority', async () => {
      // Create media that matches multiple rules
      const media = await insertTestMedia({
        filename: 'vacation_selfie.jpg'
      });

      const tags = await autoTagging.autoTagMedia(media.id);
      
      // Both vacation and selfie rules should apply
      expect(tags).toContain('vacation');
      expect(tags).toContain('selfie');
      expect(tags).toContain('portrait'); // From selfie rule
    });

    test('should disable/enable rules', async () => {
      const rules = autoTagging.getRules();
      const yearRule = rules.find(r => r.id === 'year-tags');
      
      if (yearRule) {
        // Disable rule
        await autoTagging.updateRule(yearRule.id, { enabled: false });
        
        const media = await insertTestMedia({
          createdAt: new Date('2023-06-15')
        });
        
        const tags = await autoTagging.autoTagMedia(media.id);
        
        expect(tags).not.toContain('2023');
      }
    });
  });

  describe('bulk processing', () => {
    test('should process untagged media', async () => {
      // Create untagged media
      const untaggedCount = 5;
      for (let i = 0; i < untaggedCount; i++) {
        await insertTestMedia({
          filename: `untagged${i}.jpg`,
          createdAt: new Date('2023-06-15')
        });
      }

      // Create some already tagged media
      const taggedMedia = await insertTestMedia({
        filename: 'tagged.jpg'
      });
      const tag = await insertTestTag({ name: 'existing' });
      await db.insert(schema.mediaTags).values({
        mediaId: taggedMedia.id,
        tagId: tag.id
      });

      const processed = await autoTagging.processUntaggedMedia();
      
      expect(processed).toBe(untaggedCount);
    });
  });

  describe('tag creation', () => {
    test('should not create duplicate tags', async () => {
      // Pre-create a tag
      await insertTestTag({ name: 'vacation' });
      
      const media = await insertTestMedia({
        filename: 'vacation_photo.jpg'
      });

      await autoTagging.autoTagMedia(media.id);
      
      // Check that only one vacation tag exists
      const tags = await db.select()
        .from(schema.tags)
        .where(eq(schema.tags.name, 'vacation'));
      
      expect(tags).toHaveLength(1);
    });

    test('should respect ignoreAutoTag flag', async () => {
      // Create tag with ignoreAutoTag = true
      await insertTestTag({ 
        name: 'vacation',
        ignoreAutoTag: true
      });
      
      const media = await insertTestMedia({
        filename: 'vacation_photo.jpg'
      });

      const tags = await autoTagging.autoTagMedia(media.id);
      
      // Tag should be detected but not applied
      expect(tags).not.toContain('vacation');
      expect(tags).toContain('travel'); // Other tags from the rule should still apply
    });
  });
});