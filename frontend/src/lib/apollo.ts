import { ApolloClient, InMemoryCache, createHttpLink, type FetchPolicy } from '@apollo/client';

const httpLink = createHttpLink({
  uri: 'http://localhost:4001/graphql',
});

export const apolloClient = new ApolloClient({
  link: httpLink,
  cache: new InMemoryCache({
    typePolicies: {
      MediaItem: {
        fields: {
          // Force thumbnailUrl to not cache, always refetch
          thumbnailUrl: {
            merge: false,
          }
        }
      }
    }
  }),
  defaultOptions: {
    query: {
      // Use cache-and-network to ensure fresh data while maintaining performance
      fetchPolicy: 'cache-and-network' as FetchPolicy,
    },
  },
});