import { gql } from '@apollo/client';

export const GET_ALL_MEDIA = gql`
  query GetAllMedia($limit: Int, $offset: Int, $sourcePath: String) {
    allMedia(limit: $limit, offset: $offset, sourcePath: $sourcePath) {
      id
      filename
      fileType
      createdAt
      width
      height
      duration
      thumbnailUrl
      latitude
      longitude
      altitude
      locationName
    }
  }
`;

export const GET_MEDIA_BY_YEAR = gql`
  query GetMediaByYear($year: Int!, $sourcePath: String) {
    mediaByYear(year: $year, sourcePath: $sourcePath) {
      id
      filename
      fileType
      createdAt
      width
      height
      duration
      thumbnailUrl
      latitude
      longitude
      altitude
      locationName
    }
  }
`;

export const GET_MEDIA_BY_YEAR_MONTH = gql`
  query GetMediaByYearMonth($year: Int!, $month: Int!, $sourcePath: String) {
    mediaByYearMonth(year: $year, month: $month, sourcePath: $sourcePath) {
      id
      filename
      fileType
      createdAt
      width
      height
      duration
      thumbnailUrl
      latitude
      longitude
      altitude
      locationName
    }
  }
`;

export const TRIGGER_SCAN = gql`
  mutation TriggerScan($path: String!) {
    triggerScan(path: $path) {
      processed
      newFiles
      updated
      errors {
        path
        error
      }
    }
  }
`;

export const REINDEX_THUMBNAILS = gql`
  mutation ReindexThumbnails {
    reindexThumbnails {
      success
      message
      thumbnailsProcessed
      errors
    }
  }
`;

export const CLEAR_ALL_THUMBNAILS = gql`
  mutation ClearAllThumbnails {
    clearAllThumbnails {
      success
      message
      thumbnailsProcessed
      errors
    }
  }
`;

export const EXPORT_DUPLICATES = gql`
  mutation ExportDuplicates($format: String) {
    exportDuplicatePaths(format: $format)
  }
`;

export const CLEAR_DUPLICATE_DATA = gql`
  mutation ClearDuplicateData {
    clearDuplicateData {
      success
      message
    }
  }
`;