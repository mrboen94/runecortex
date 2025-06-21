import { MediaFilterInput, TagFilterInput, CollectionFilterInput, CriterionModifier } from '../models/filter';

interface SearchOperator {
  operator: string;
  field: string;
  value: string;
  modifier?: CriterionModifier;
}

export class SearchService {
  private readonly operatorMap: Record<string, CriterionModifier> = {
    ':': CriterionModifier.INCLUDES,
    '=': CriterionModifier.EQUALS,
    '!=': CriterionModifier.NOT_EQUALS,
    '>': CriterionModifier.GREATER_THAN,
    '<': CriterionModifier.LESS_THAN,
    '>=': CriterionModifier.GREATER_THAN, // Will handle in range
    '<=': CriterionModifier.LESS_THAN,    // Will handle in range
    '~': CriterionModifier.MATCHES_REGEX,
    '!~': CriterionModifier.NOT_MATCHES_REGEX,
  };

  private readonly fieldAliases: Record<string, string> = {
    // Media field aliases
    'name': 'filename',
    'file': 'filename',
    'path': 'filepath',
    'size': 'fileSize',
    'res': 'resolution',
    'fav': 'favorite',
    'org': 'organized',
    'desc': 'description',
    'created': 'createdAt',
    'updated': 'updatedAt',
    'added': 'addedAt',
    'type': 'fileType',
    
    // Tag field aliases
    'tag': 'tags',
    't': 'tags',
    
    // Collection field aliases
    'collection': 'collections',
    'col': 'collections',
    'c': 'collections',
    'gallery': 'collections',
    'gal': 'collections',
    
    // Other aliases
    'duplicate': 'hasDuplicates',
    'dup': 'hasDuplicates',
    'hash': 'phash',
  };

  parseSearchQuery(query: string): {
    filters: SearchOperator[];
    freeText: string[];
  } {
    const filters: SearchOperator[] = [];
    const freeText: string[] = [];
    
    // Regular expression to match search operators
    // Matches: field:value, field=value, field>value, etc.
    const operatorRegex = /(\w+)([:=!<>~]+)("[^"]*"|'[^']*'|\S+)/g;
    
    let lastIndex = 0;
    let match;
    
    while ((match = operatorRegex.exec(query)) !== null) {
      // Add any text before this match as free text
      const textBefore = query.substring(lastIndex, match.index).trim();
      if (textBefore) {
        freeText.push(...textBefore.split(/\s+/).filter(t => t));
      }
      
      const [fullMatch, field, operator, value] = match;
      
      // Remove quotes if present
      const cleanValue = value.replace(/^["']|["']$/g, '');
      
      // Normalize field name
      const normalizedField = this.fieldAliases[field.toLowerCase()] || field.toLowerCase();
      
      // Determine modifier
      let modifier = this.operatorMap[operator];
      if (!modifier && operator.startsWith('!')) {
        // Handle negation operators like !=, !~
        const baseOp = operator.substring(1);
        const baseModifier = this.operatorMap[baseOp];
        if (baseModifier === CriterionModifier.INCLUDES) {
          modifier = CriterionModifier.EXCLUDES;
        } else if (baseModifier === CriterionModifier.MATCHES_REGEX) {
          modifier = CriterionModifier.NOT_MATCHES_REGEX;
        }
      }
      
      filters.push({
        operator,
        field: normalizedField,
        value: cleanValue,
        modifier: modifier || CriterionModifier.EQUALS,
      });
      
      lastIndex = match.index + fullMatch.length;
    }
    
    // Add any remaining text as free text
    const remainingText = query.substring(lastIndex).trim();
    if (remainingText) {
      freeText.push(...remainingText.split(/\s+/).filter(t => t));
    }
    
    return { filters, freeText };
  }

  buildMediaFilter(query: string): MediaFilterInput {
    const { filters, freeText } = this.parseSearchQuery(query);
    const filter: MediaFilterInput = {};
    
    // Handle free text search (search in filename, title, description)
    if (freeText.length > 0) {
      const searchTerm = freeText.join(' ');
      filter.OR = [
        { filename: { value: searchTerm, modifier: CriterionModifier.INCLUDES } },
        { title: { value: searchTerm, modifier: CriterionModifier.INCLUDES } },
        { description: { value: searchTerm, modifier: CriterionModifier.INCLUDES } },
      ];
    }
    
    // Apply search operators
    for (const op of filters) {
      switch (op.field) {
        case 'filename':
        case 'filepath':
        case 'title':
        case 'description':
        case 'filetype':
        case 'phash':
          filter[op.field as keyof MediaFilterInput] = {
            value: op.value,
            modifier: op.modifier!,
          } as any;
          break;
        
        case 'filesize':
        case 'duration':
        case 'width':
        case 'height':
        case 'rating':
          filter[op.field as keyof MediaFilterInput] = {
            value: parseInt(op.value),
            modifier: op.modifier!,
          } as any;
          break;
        
        case 'resolution':
          // Convert resolution shortcuts
          const resMap: Record<string, string> = {
            '480p': 'LOW',
            '720p': 'HD',
            '1080p': 'FULL_HD',
            '4k': 'FOUR_K',
            '8k': 'EIGHT_K',
          };
          filter.resolution = {
            value: resMap[op.value.toLowerCase()] || op.value.toUpperCase(),
            modifier: op.modifier!,
          } as any;
          break;
        
        case 'orientation':
          filter.orientation = {
            value: op.value.toUpperCase(),
          } as any;
          break;
        
        case 'favorite':
        case 'organized':
          filter[op.field] = op.value.toLowerCase() === 'true' || op.value === '1';
          break;
        
        case 'hasduplicates':
          filter.hasDuplicates = op.value.toLowerCase() === 'true' || op.value === '1';
          break;
        
        case 'tags':
          filter.tags = {
            value: op.value,
            modifier: op.modifier!,
          };
          break;
        
        case 'collections':
          filter.collections = {
            value: op.value,
            modifier: op.modifier!,
          };
          break;
        
        case 'tagcount':
        case 'collectioncount':
          filter[op.field as keyof MediaFilterInput] = {
            value: parseInt(op.value),
            modifier: op.modifier!,
          } as any;
          break;
        
        case 'createdat':
        case 'updatedat':
          // Parse date shortcuts
          const dateValue = this.parseDateValue(op.value);
          if (dateValue) {
            filter[op.field as keyof MediaFilterInput] = {
              value: dateValue,
              modifier: op.modifier!,
            } as any;
          }
          break;
      }
    }
    
    return filter;
  }

  buildTagFilter(query: string): TagFilterInput {
    const { filters, freeText } = this.parseSearchQuery(query);
    const filter: TagFilterInput = {};
    
    // Handle free text search
    if (freeText.length > 0) {
      const searchTerm = freeText.join(' ');
      filter.OR = [
        { name: { value: searchTerm, modifier: CriterionModifier.INCLUDES } },
        { description: { value: searchTerm, modifier: CriterionModifier.INCLUDES } },
        { aliases: { value: searchTerm, modifier: CriterionModifier.INCLUDES } },
      ];
    }
    
    // Apply search operators
    for (const op of filters) {
      switch (op.field) {
        case 'name':
        case 'description':
        case 'aliases':
          filter[op.field] = {
            value: op.value,
            modifier: op.modifier!,
          };
          break;
        
        case 'parentid':
        case 'childcount':
        case 'mediacount':
          filter[op.field as keyof TagFilterInput] = {
            value: parseInt(op.value),
            modifier: op.modifier!,
          } as any;
          break;
        
        case 'favorite':
        case 'ignoreautotag':
          filter[op.field as keyof TagFilterInput] = op.value.toLowerCase() === 'true' || op.value === '1';
          break;
      }
    }
    
    return filter;
  }

  buildCollectionFilter(query: string): CollectionFilterInput {
    const { filters, freeText } = this.parseSearchQuery(query);
    const filter: CollectionFilterInput = {};
    
    // Handle free text search
    if (freeText.length > 0) {
      const searchTerm = freeText.join(' ');
      filter.OR = [
        { title: { value: searchTerm, modifier: CriterionModifier.INCLUDES } },
        { description: { value: searchTerm, modifier: CriterionModifier.INCLUDES } },
      ];
    }
    
    // Apply search operators
    for (const op of filters) {
      switch (op.field) {
        case 'title':
        case 'description':
          filter[op.field] = {
            value: op.value,
            modifier: op.modifier!,
          };
          break;
        
        case 'rating':
        case 'parentid':
        case 'childcount':
        case 'mediacount':
          filter[op.field as keyof CollectionFilterInput] = {
            value: parseInt(op.value),
            modifier: op.modifier!,
          } as any;
          break;
        
        case 'date':
          const dateValue = this.parseDateValue(op.value);
          if (dateValue) {
            filter.date = {
              value: dateValue,
              modifier: op.modifier!,
            };
          }
          break;
        
        case 'favorite':
        case 'organized':
          filter[op.field] = op.value.toLowerCase() === 'true' || op.value === '1';
          break;
      }
    }
    
    return filter;
  }

  private parseDateValue(value: string): Date | null {
    // Handle relative dates
    const relativeRegex = /^(\d+)([dwmy])$/i;
    const match = value.match(relativeRegex);
    
    if (match) {
      const [, amount, unit] = match;
      const date = new Date();
      const num = parseInt(amount);
      
      switch (unit.toLowerCase()) {
        case 'd':
          date.setDate(date.getDate() - num);
          break;
        case 'w':
          date.setDate(date.getDate() - (num * 7));
          break;
        case 'm':
          date.setMonth(date.getMonth() - num);
          break;
        case 'y':
          date.setFullYear(date.getFullYear() - num);
          break;
      }
      
      return date;
    }
    
    // Handle special keywords
    const today = new Date();
    switch (value.toLowerCase()) {
      case 'today':
        return today;
      case 'yesterday':
        const yesterday = new Date(today);
        yesterday.setDate(yesterday.getDate() - 1);
        return yesterday;
      case 'lastweek':
        const lastWeek = new Date(today);
        lastWeek.setDate(lastWeek.getDate() - 7);
        return lastWeek;
      case 'lastmonth':
        const lastMonth = new Date(today);
        lastMonth.setMonth(lastMonth.getMonth() - 1);
        return lastMonth;
      case 'lastyear':
        const lastYear = new Date(today);
        lastYear.setFullYear(lastYear.getFullYear() - 1);
        return lastYear;
    }
    
    // Try to parse as date
    const parsed = new Date(value);
    return isNaN(parsed.getTime()) ? null : parsed;
  }

  generateSearchHelp(): string {
    return `
# Advanced Search Syntax

## Basic Search
- Type any text to search in filenames, titles, and descriptions
- Use quotes for exact phrases: "family vacation"

## Field Operators
- field:value - Contains value
- field=value - Equals exactly
- field!=value - Not equals
- field>value - Greater than
- field<value - Less than
- field~regex - Matches regex
- field!~regex - Doesn't match regex

## Media Fields
- filename, name, file - Search in filename
- title - Search in title
- description, desc - Search in description
- path - Search in full file path
- size - File size in bytes
- duration - Duration in seconds
- width, height - Dimensions in pixels
- resolution, res - Resolution (480p, 720p, 1080p, 4k, 8k)
- orientation - portrait, landscape, square
- rating - Rating value (1-5)
- favorite, fav - true/false
- organized, org - true/false
- type - File type (image/video)
- tag, t - Has tag
- collection, col, c - In collection
- tagcount - Number of tags
- collectioncount - Number of collections
- duplicate, dup - Has duplicates (true/false)
- created, createdat - Creation date
- updated, updatedat - Last update date

## Tag Fields
- name - Tag name
- description - Tag description
- aliases - Tag aliases
- parentid - Parent tag ID
- childcount - Number of child tags
- mediacount - Number of media items
- favorite - Is favorite (true/false)
- ignoreautotag - Ignore in auto-tagging (true/false)

## Collection Fields
- title - Collection title
- description - Collection description
- date - Collection date
- rating - Collection rating
- parentid - Parent collection ID
- childcount - Number of child collections
- mediacount - Number of media items
- favorite - Is favorite (true/false)
- organized - Is organized (true/false)

## Date Values
- Specific date: 2024-01-15
- Relative dates: 7d (7 days ago), 2w (2 weeks), 3m (3 months), 1y (1 year)
- Keywords: today, yesterday, lastweek, lastmonth, lastyear

## Examples
- rating>3 favorite:true - Highly rated favorites
- type:video duration>300 - Videos longer than 5 minutes
- tag:vacation created>1m - Vacation photos from last month
- resolution>=1080p type:video - HD or better videos
- filename~"IMG_\\d{4}" - Files matching pattern
- size>10000000 duplicate:true - Large duplicate files
    `.trim();
  }

  // Parse complex boolean queries
  parseComplexQuery(query: string): any {
    // This is a simplified version. A full implementation would need
    // a proper parser for handling parentheses and complex boolean logic
    
    // Split by AND/OR operators
    const andParts = query.split(/\s+AND\s+/i);
    if (andParts.length > 1) {
      return {
        AND: andParts.map(part => this.parseComplexQuery(part.trim())),
      };
    }
    
    const orParts = query.split(/\s+OR\s+/i);
    if (orParts.length > 1) {
      return {
        OR: orParts.map(part => this.parseComplexQuery(part.trim())),
      };
    }
    
    // Check for NOT
    if (query.toUpperCase().startsWith('NOT ')) {
      return {
        NOT: this.parseComplexQuery(query.substring(4).trim()),
      };
    }
    
    // Parse as simple query
    return this.buildMediaFilter(query);
  }
}

export const searchService = new SearchService();