// Advanced filtering system inspired by stash
// Supports complex queries with AND/OR/NOT operations and various modifiers

export enum CriterionModifier {
  // Basic comparisons
  EQUALS = 'EQUALS',
  NOT_EQUALS = 'NOT_EQUALS',
  
  // Numeric comparisons
  GREATER_THAN = 'GREATER_THAN',
  LESS_THAN = 'LESS_THAN',
  BETWEEN = 'BETWEEN',
  NOT_BETWEEN = 'NOT_BETWEEN',
  
  // Null checks
  IS_NULL = 'IS_NULL',
  NOT_NULL = 'NOT_NULL',
  
  // String operations
  INCLUDES = 'INCLUDES',
  EXCLUDES = 'EXCLUDES',
  MATCHES_REGEX = 'MATCHES_REGEX',
  NOT_MATCHES_REGEX = 'NOT_MATCHES_REGEX',
  
  // Array operations
  INCLUDES_ALL = 'INCLUDES_ALL',
  INCLUDES_ANY = 'INCLUDES_ANY',
}

export enum FilterMode {
  MEDIA = 'MEDIA',
  COLLECTIONS = 'COLLECTIONS',
  TAGS = 'TAGS',
}

export enum SortDirection {
  ASC = 'ASC',
  DESC = 'DESC',
}

export interface HierarchicalCriterionInput {
  value: string | number;
  modifier: CriterionModifier;
  depth?: number; // For hierarchical tags/collections
}

export interface StringCriterionInput {
  value: string;
  modifier: CriterionModifier;
}

export interface IntCriterionInput {
  value: number;
  value2?: number; // For BETWEEN operations
  modifier: CriterionModifier;
}

export interface DateCriterionInput {
  value: string; // ISO date string
  value2?: string; // For BETWEEN operations
  modifier: CriterionModifier;
}

export interface ResolutionCriterionInput {
  value: ResolutionEnum;
  modifier: CriterionModifier;
}

export enum ResolutionEnum {
  VERY_LOW = 'VERY_LOW',     // < 480p
  LOW = 'LOW',               // 480p
  SD = 'SD',                 // 540p, 576p
  HD = 'HD',                 // 720p
  FULL_HD = 'FULL_HD',       // 1080p
  QUAD_HD = 'QUAD_HD',       // 1440p
  VR_HD = 'VR_HD',          // 1920p
  FOUR_K = 'FOUR_K',        // 4K
  FIVE_K = 'FIVE_K',        // 5K
  SIX_K = 'SIX_K',          // 6K
  SEVEN_K = 'SEVEN_K',      // 7K
  EIGHT_K = 'EIGHT_K',      // 8K
}

export interface OrientationCriterionInput {
  value: OrientationEnum;
}

export enum OrientationEnum {
  PORTRAIT = 'PORTRAIT',
  LANDSCAPE = 'LANDSCAPE',
  SQUARE = 'SQUARE',
}

// Main filter criteria for media items
export interface MediaFilterInput {
  AND?: MediaFilterInput[];
  OR?: MediaFilterInput[];
  NOT?: MediaFilterInput;
  
  // Basic fields
  id?: IntCriterionInput;
  path?: StringCriterionInput;
  filename?: StringCriterionInput;
  title?: StringCriterionInput;
  description?: StringCriterionInput;
  
  // Ratings and favorites
  rating?: IntCriterionInput;
  favorite?: boolean;
  organized?: boolean;
  
  // File properties
  fileSize?: IntCriterionInput;
  duration?: IntCriterionInput;
  width?: IntCriterionInput;
  height?: IntCriterionInput;
  resolution?: ResolutionCriterionInput;
  orientation?: OrientationCriterionInput;
  fileType?: StringCriterionInput;
  
  // Dates
  createdAt?: DateCriterionInput;
  updatedAt?: DateCriterionInput;
  
  // Relationships
  tags?: HierarchicalCriterionInput;
  tagCount?: IntCriterionInput;
  collections?: HierarchicalCriterionInput;
  collectionCount?: IntCriterionInput;
  
  // Custom fields
  customFields?: CustomFieldFilterInput[];
  
  // Duplicate detection
  hasDuplicates?: boolean;
  phash?: StringCriterionInput;
}

// Tag filter criteria
export interface TagFilterInput {
  AND?: TagFilterInput[];
  OR?: TagFilterInput[];
  NOT?: TagFilterInput;
  
  id?: IntCriterionInput;
  name?: StringCriterionInput;
  description?: StringCriterionInput;
  aliases?: StringCriterionInput;
  parentId?: IntCriterionInput;
  childCount?: IntCriterionInput;
  mediaCount?: IntCriterionInput;
  favorite?: boolean;
  ignoreAutoTag?: boolean;
}

// Collection filter criteria
export interface CollectionFilterInput {
  AND?: CollectionFilterInput[];
  OR?: CollectionFilterInput[];
  NOT?: CollectionFilterInput;
  
  id?: IntCriterionInput;
  title?: StringCriterionInput;
  description?: StringCriterionInput;
  date?: DateCriterionInput;
  rating?: IntCriterionInput;
  favorite?: boolean;
  organized?: boolean;
  parentId?: IntCriterionInput;
  childCount?: IntCriterionInput;
  mediaCount?: IntCriterionInput;
}

// Custom field filtering
export interface CustomFieldFilterInput {
  fieldName: string;
  fieldValue: StringCriterionInput;
  fieldType?: string;
}

// Sorting options
export interface SortInput {
  field: string;
  direction: SortDirection;
}

// Find filter with pagination
export interface FindFilterInput {
  q?: string; // Quick search
  page?: number;
  perPage?: number;
  sort?: SortInput;
  direction?: SortDirection;
}

// Complete query input
export interface MediaQueryInput {
  filter?: MediaFilterInput;
  findFilter?: FindFilterInput;
}

export interface TagQueryInput {
  filter?: TagFilterInput;
  findFilter?: FindFilterInput;
}

export interface CollectionQueryInput {
  filter?: CollectionFilterInput;
  findFilter?: FindFilterInput;
}

// Utility functions for resolution detection
export function getResolutionEnum(width: number, height: number): ResolutionEnum {
  const pixels = width * height;
  
  if (pixels < 307200) return ResolutionEnum.VERY_LOW; // < 640x480
  if (pixels <= 409920) return ResolutionEnum.LOW; // 854x480
  if (pixels <= 786432) return ResolutionEnum.SD; // 1024x768
  if (pixels <= 1049088) return ResolutionEnum.HD; // 1366x768
  if (pixels <= 2211840) return ResolutionEnum.FULL_HD; // 1920x1152
  if (pixels <= 3686400) return ResolutionEnum.QUAD_HD; // 2560x1440
  if (pixels <= 4147200) return ResolutionEnum.VR_HD; // 2880x1440
  if (pixels <= 8847360) return ResolutionEnum.FOUR_K; // 4096x2160
  if (pixels <= 14745600) return ResolutionEnum.FIVE_K; // 5120x2880
  if (pixels <= 19906560) return ResolutionEnum.SIX_K; // 6144x3240
  if (pixels <= 29491200) return ResolutionEnum.SEVEN_K; // 7680x3840
  return ResolutionEnum.EIGHT_K; // > 7680x4320
}

export function getOrientation(width: number, height: number): OrientationEnum {
  const ratio = width / height;
  if (ratio > 1.1) return OrientationEnum.LANDSCAPE;
  if (ratio < 0.9) return OrientationEnum.PORTRAIT;
  return OrientationEnum.SQUARE;
}