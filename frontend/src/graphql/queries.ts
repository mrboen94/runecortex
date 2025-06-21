import { gql } from '@apollo/client';

export const GET_ALL_MEDIA = gql`
  query GetAllMedia($limit: Int, $offset: Int) {
    allMedia(limit: $limit, offset: $offset) {
      id
      filename
      fileType
      createdAt
      width
      height
      duration
      thumbnailUrl
    }
  }
`;

export const GET_MEDIA_BY_YEAR = gql`
  query GetMediaByYear($year: Int!) {
    mediaByYear(year: $year) {
      id
      filename
      fileType
      createdAt
      width
      height
      duration
      thumbnailUrl
    }
  }
`;

export const GET_MEDIA_BY_YEAR_MONTH = gql`
  query GetMediaByYearMonth($year: Int!, $month: Int!) {
    mediaByYearMonth(year: $year, month: $month) {
      id
      filename
      fileType
      createdAt
      width
      height
      duration
      thumbnailUrl
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