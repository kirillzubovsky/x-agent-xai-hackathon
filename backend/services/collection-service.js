import { PrismaClient } from '@prisma/client';
import { xAPI } from '../lib/twitter-api.js';
import { logger } from '../../logger.js';
import { config } from '../config.js';

const prisma = new PrismaClient();

export class CollectionService {
  constructor() {
    this.activeCollections = new Map();
  }

  /**
   * Start collecting tweets for a user
   * @param {string} userId - Database user ID
   * @param {object} options - Collection options
   */
  async startCollection(userId, options = {}) {
    try {
      // Check if already collecting for this user in database
      const existingCollection = await prisma.dataCollection.findFirst({
        where: {
          userId,
          collectionType: 'tweets',
          status: 'running'
        }
      });

      if (existingCollection) {
        logger.feature('Collection already active for user', { userId });
        return { status: 'already_running' };
      }

      // Check for interrupted collections that can be resumed
      const interruptedCollection = await prisma.dataCollection.findFirst({
        where: {
          userId,
          collectionType: 'tweets',
          status: 'interrupted'
        },
        orderBy: { startedAt: 'desc' }
      });

      // Get user from database
      const user = await prisma.user.findUnique({
        where: { id: userId }
      });

      if (!user) {
        throw new Error('User not found');
      }

      let collection;
      let isResume = false;

      if (interruptedCollection && options.resume !== false) {
        // Resume the interrupted collection
        collection = await prisma.dataCollection.update({
          where: { id: interruptedCollection.id },
          data: {
            status: 'running',
            errorMessage: null,
            startedAt: new Date()  // Reset start time for resumed collection
          }
        });
        isResume = true;
        logger.feature('Resuming interrupted collection', {
          userId,
          username: user.username,
          collectionId: collection.id,
          previousItemsCollected: collection.itemsCollected
        });
      } else {
        // Create new collection record
        collection = await prisma.dataCollection.create({
          data: {
            userId,
            collectionType: 'tweets',
            status: 'running',
            startedAt: new Date()
          }
        });
        logger.feature('Starting new collection', {
          userId,
          username: user.username,
          collectionId: collection.id
        });
      }

      // Mark as active
      this.activeCollections.set(userId, collection.id);

      // Start collection in background (will continue from where it left off)
      this.collectTweetsInBackground(user, collection.id, options);

      return {
        status: isResume ? 'resumed' : 'started',
        collectionId: collection.id,
        username: user.username,
        resumed: isResume,
        previousItems: isResume ? collection.itemsCollected : 0
      };

    } catch (error) {
      logger.error('Failed to start collection', {
        error: error.message,
        userId
      });
      throw error;
    }
  }

  /**
   * Collect tweets in background
   * @private
   */
  async collectTweetsInBackground(user, collectionId, options = {}) {
    const maxTweets = options.maxTweets ?? (config.collection.maxTweetsPerSession === 0 ? Infinity : (config.collection.maxTweetsPerSession || 10000)); // High/unlimited for enterprise
    const includeReplies = options.includeReplies !== false;
    let tweetsCollected = 0;
    let oldestTweetId = null;
    let hasMoreTweets = true;

    try {
      logger.collection('Starting background tweet collection', {
        username: user.username,
        maxTweets,
        includeReplies
      });

      // Get the most recent tweet to avoid duplicates
      const mostRecentTweet = await prisma.tweet.findFirst({
        where: { userId: user.id },
        orderBy: { createdAt: 'desc' }
      });

      const sinceId = mostRecentTweet?.id;

      while (hasMoreTweets && tweetsCollected < maxTweets) {
        try {
          // Fetch tweets from API
          const response = await xAPI.getUserTweets(user.twitterUserId, {
            maxResults: Math.min(100, maxTweets - tweetsCollected),
            paginationToken: oldestTweetId,
            sinceId: sinceId, // Fetch newer than last known to avoid dups/old
            excludeReplies: !includeReplies,
            excludeRetweets: true
          });

          logger.collection(`API Response for batch`, {
            userId: user.twitterUserId,
            fetched: response.data?.length || 0,
            hasNext: !!response.nextToken,
            sinceId: sinceId || 'none'
          });

          if (!response?.data || response.data.length === 0) {
            hasMoreTweets = false;
            break;
          }

          // Process and save tweets
          const tweetsToCreate = [];
          for (const tweet of response.data) {
            // Skip if already exists
            const exists = await prisma.tweet.findUnique({
              where: { id: tweet.id }
            });

            if (!exists) {
              const isReply = !!(tweet.in_reply_to_user_id || tweet.referenced_tweets?.some(
                ref => ref.type === 'replied_to'
              ));

              // Sanitize long fields to prevent DB errors (e.g., JSON too large or invalid chars)
              const content = (tweet.text || '').substring(0, 1000).replace(/[\0-\x1F\x7F-\x9F]/g, ''); // Trim & remove control chars
              const annotationsStr = tweet.context_annotations ? JSON.stringify(tweet.context_annotations).substring(0, 50000) : null;
              const metricsStr = JSON.stringify(tweet.public_metrics || {}).substring(0, 50000);

              tweetsToCreate.push({
                id: tweet.id,
                userId: user.id,
                content,
                inReplyToUserId: tweet.in_reply_to_user_id || null,
                inReplyToTweetId: tweet.referenced_tweets?.find(
                  ref => ref.type === 'replied_to'
                )?.id || null,
                lang: tweet.lang || null,
                source: tweet.source || null,
                contextAnnotationsJson: annotationsStr,
                createdAt: new Date(tweet.created_at),
                metricsJson: metricsStr,
                hasReplies: tweet.public_metrics?.reply_count > 0,
                hasQuotes: tweet.public_metrics?.quote_count > 0,
                hasEngagement: (tweet.public_metrics?.reply_count > 0) ||
                              (tweet.public_metrics?.quote_count > 0),
                isReply,
                isDeleted: false
              });
            }
          }

          // Batch insert tweets
          if (tweetsToCreate.length > 0) {
            try {
              const result = await prisma.tweet.createMany({
                data: tweetsToCreate
              }); // No skipDuplicates (not supported; pre-check prevents dups)

              // Only count tweets that were actually inserted
              tweetsCollected += result.count;
              logger.collection(`Collected ${result.count} new tweets for @${user.username}`, {
                newTweets: result.count,
                attempted: tweetsToCreate.length,
                total: tweetsCollected
              });
            } catch (dbError) {
              // Log the actual database error
              logger.error('Database error during tweet insertion', {
                error: dbError.message,
                code: dbError.code,
                meta: dbError.meta,
                tweetsAttempted: tweetsToCreate.length,
                firstTweet: tweetsToCreate[0]?.id,
                lastTweet: tweetsToCreate[tweetsToCreate.length - 1]?.id
              });

              // Try to insert tweets one by one to identify the problematic tweet
              let successCount = 0;
              for (const tweetData of tweetsToCreate) {
                try {
                  await prisma.tweet.create({
                    data: tweetData
                  });
                  successCount++;
                } catch (singleError) {
                  logger.error('Failed to insert individual tweet', {
                    tweetId: tweetData.id,
                    error: singleError.message,
                    content: tweetData.content?.substring(0, 100) + '...'
                  });
                }
              }

              tweetsCollected += successCount;
              logger.collection(`Recovered ${successCount} tweets after batch error`, {
                successful: successCount,
                failed: tweetsToCreate.length - successCount
              });
            }
          }

          // Update collection progress
          await prisma.dataCollection.update({
            where: { id: collectionId },
            data: { itemsCollected: tweetsCollected }
          });

          // Check for next page
          if (response.nextToken) {
            oldestTweetId = response.nextToken;
          } else {
            hasMoreTweets = false;
          }

          // Minimal delay between requests (configurable, 0 for full speed)
          await new Promise(resolve => setTimeout(resolve, config.collection.cooldownMs || 100));

        } catch (error) {
          logger.error('Error fetching tweets batch', {
            error: error.message,
            username: user.username
          });

          // If rate limited, wait and continue
          if (error.message?.includes('rate limit')) {
            logger.collection('Rate limited, waiting briefly...', {
              username: user.username
            });
            await new Promise(resolve => setTimeout(resolve, 1000));
            continue;
          }

          // For other errors, stop collection
          throw error;
        }
      }

      // Mark collection as completed
      await prisma.dataCollection.update({
        where: { id: collectionId },
        data: {
          status: 'completed',
          completedAt: new Date(),
          itemsCollected: tweetsCollected
        }
      });

      logger.feature('Tweet collection completed', {
        username: user.username,
        tweetsCollected,
        collectionId
      });

    } catch (error) {
      logger.error('Tweet collection failed', {
        error: error.message,
        username: user.username,
        collectionId
      });

      // Mark collection as failed
      await prisma.dataCollection.update({
        where: { id: collectionId },
        data: {
          status: 'failed',
          completedAt: new Date(),
          errorMessage: error.message
        }
      });

    } finally {
      // Remove from active collections
      this.activeCollections.delete(user.id);
    }
  }

  /**
   * Get collection status
   */
  async getCollectionStatus(userId) {
    const collections = await prisma.dataCollection.findMany({
      where: { userId },
      orderBy: { createdAt: 'desc' },
      take: 10
    });

    return collections;
  }

  /**
   * Check if collection is active for user
   */
  isCollecting(userId) {
    return this.activeCollections.has(userId);
  }

  /**
   * Resume an interrupted collection
   */
  async resumeCollection(userId) {
    try {
      const interruptedCollection = await prisma.dataCollection.findFirst({
        where: {
          userId,
          collectionType: 'tweets',
          status: 'interrupted'
        },
        orderBy: { startedAt: 'desc' }
      });

      if (!interruptedCollection) {
        return { status: 'no_interrupted_collection' };
      }

      // Resume by starting collection with resume flag
      return await this.startCollection(userId, { resume: true });

    } catch (error) {
      logger.error('Failed to resume collection', {
        error: error.message,
        userId
      });
      throw error;
    }
  }

  /**
   * Clear an interrupted collection
   */
  async clearInterruptedCollection(userId, collectionId = null) {
    try {
      const where = collectionId
        ? { id: collectionId, userId }
        : { userId, status: 'interrupted' };

      const result = await prisma.dataCollection.updateMany({
        where,
        data: {
          status: 'cancelled',
          completedAt: new Date(),
          errorMessage: 'Manually cancelled'
        }
      });

      logger.feature('Cleared interrupted collection', {
        userId,
        collectionId,
        count: result.count
      });

      return { cleared: result.count };

    } catch (error) {
      logger.error('Failed to clear interrupted collection', {
        error: error.message,
        userId,
        collectionId
      });
      throw error;
    }
  }

  /**
   * Check for and handle stale running collections
   * This can be called periodically to clean up stuck collections
   */
  async cleanupStaleCollections() {
    try {
      const oneHourAgo = new Date(Date.now() - 60 * 60 * 1000);

      // Find collections that have been running for more than 1 hour
      const staleCollections = await prisma.dataCollection.findMany({
        where: {
          status: 'running',
          startedAt: { lt: oneHourAgo }
        }
      });

      if (staleCollections.length > 0) {
        logger.warn('Found stale collections', {
          count: staleCollections.length,
          collections: staleCollections.map(c => ({
            id: c.id,
            userId: c.userId,
            startedAt: c.startedAt
          }))
        });

        // Mark them as interrupted
        const result = await prisma.dataCollection.updateMany({
          where: {
            id: { in: staleCollections.map(c => c.id) }
          },
          data: {
            status: 'interrupted',
            errorMessage: 'Collection timed out after 1 hour'
          }
        });

        logger.system('Cleaned up stale collections', {
          count: result.count
        });

        return { cleaned: result.count };
      }

      return { cleaned: 0 };

    } catch (error) {
      logger.error('Failed to cleanup stale collections', {
        error: error.message
      });
      throw error;
    }
  }
}

// Export singleton instance
export const collectionService = new CollectionService();