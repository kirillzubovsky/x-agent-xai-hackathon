#!/usr/bin/env node

/**
 * X-Agent Continuous Tweet Collector
 * No time limits, collects all tweets, excludes replies to others
 */

import { PrismaClient } from '@prisma/client';
import { xAPI } from '../lib/twitter-api.js';
import { logger } from '../../logger.js';
import { rateLimitManager } from '../lib/rate-limiter.js';

const prisma = new PrismaClient();

class ContinuousTweetCollector {
  constructor() {
    this.isCollecting = false;
    this.stopRequested = false;
    this.totalCollected = 0;
    this.startTime = Date.now();
  }

  setupShutdownHandlers() {
    const shutdown = async () => {
      console.log('\n⏸️  Shutdown signal received...');
      this.stopRequested = true;

      if (this.isCollecting) {
        console.log('⏳ Waiting for current batch to complete...');
        setTimeout(() => {
          console.log('\n✅ Collection stopped');
          console.log(`📊 Final: ${this.totalCollected} tweets collected`);
          console.log(`⏱️  Time: ${this.getElapsedTime()}`);
          process.exit(0);
        }, 3000);
      } else {
        process.exit(0);
      }
    };

    process.on('SIGINT', shutdown);
    process.on('SIGTERM', shutdown);
  }

  getElapsedTime() {
    const elapsed = Date.now() - this.startTime;
    const hours = Math.floor(elapsed / 3600000);
    const minutes = Math.floor((elapsed % 3600000) / 60000);
    const seconds = Math.floor((elapsed % 60000) / 1000);

    if (hours > 0) {
      return `${hours}h ${minutes}m ${seconds}s`;
    } else if (minutes > 0) {
      return `${minutes}m ${seconds}s`;
    } else {
      return `${seconds}s`;
    }
  }

  async getOrCreateUser(username) {
    console.log(`🔍 Looking up user: ${username}`);

    const cleanUsername = username.replace('@', '');

    try {
      const apiUser = await xAPI.getUserByUsername(cleanUsername);
      if (!apiUser?.data) {
        throw new Error(`User @${cleanUsername} not found on Twitter API`);
      }
      const userData = apiUser.data;

      // Check for existing by twitterUserId to avoid unique constraint and keep fresh
      let targetUser = await prisma.user.findUnique({
        where: { twitterUserId: userData.id }
      });
      if (targetUser) {
        console.log(`🔄 Updating existing user @${targetUser.username} with fresh data`);
        targetUser = await prisma.user.update({
          where: { id: targetUser.id },
          data: {
            username: cleanUsername,
            displayName: userData.name,
            description: userData.description || null,
            profileImageUrl: userData.profile_image_url || null,
            verified: userData.verified || false,
            verifiedType: userData.verified_type || null,
            followersCount: userData.public_metrics?.followers_count || 0,
            followingCount: userData.public_metrics?.following_count || 0,
            tweetCount: userData.public_metrics?.tweet_count || 0,
            listedCount: userData.public_metrics?.listed_count || 0,
          }
        });
      } else {
        // Upsert by username as fallback
        targetUser = await prisma.user.upsert({
          where: { username: cleanUsername },
          update: {
            twitterUserId: userData.id,
            displayName: userData.name,
            description: userData.description || null,
            profileImageUrl: userData.profile_image_url || null,
            verified: userData.verified || false,
            verifiedType: userData.verified_type || null,
            followersCount: userData.public_metrics?.followers_count || 0,
            followingCount: userData.public_metrics?.following_count || 0,
            tweetCount: userData.public_metrics?.tweet_count || 0,
            listedCount: userData.public_metrics?.listed_count || 0,
          },
          create: {
            username: cleanUsername,
            twitterUserId: userData.id,
            displayName: userData.name,
            description: userData.description || null,
            profileImageUrl: userData.profile_image_url || null,
            verified: userData.verified || false,
            verifiedType: userData.verified_type || null,
            followersCount: userData.public_metrics?.followers_count || 0,
            followingCount: userData.public_metrics?.following_count || 0,
            tweetCount: userData.public_metrics?.tweet_count || 0,
            listedCount: userData.public_metrics?.listed_count || 0,
          }
        });
      }
      const user = targetUser;

      console.log(`✅ User: @${user.username} (${user.displayName})`);
      console.log(`📊 Stats: ${user.followersCount} followers, ${user.tweetCount} tweets`);

      return user;
    } catch (error) {
      console.error(`❌ Failed to lookup user: ${error.message}`);
      throw error;
    }
  }

  async storeTweets(userId, tweets) {
    let stored = 0;
    let updated = 0;
    let replies = 0;

    for (const tweet of tweets) {
      try {
        const metrics = tweet.public_metrics || {};

        // Check if this is a reply to someone else
        const isReply = !!(tweet.in_reply_to_user_id &&
                          tweet.in_reply_to_user_id !== tweets[0]?.author_id);

        if (isReply) {
          replies++;
          //We still store replies but mark them
        }

        // Extract reply reference
        const referencedTweets = tweet.referenced_tweets || [];
        const replyReference = referencedTweets.find(ref => ref.type === 'replied_to');
        const inReplyToTweetId = replyReference?.id || null;

        const contextAnnotations = tweet.context_annotations
          ? JSON.stringify(tweet.context_annotations)
          : null;

        const result = await prisma.tweet.upsert({
          where: { id: tweet.id },
          update: {
            content: tweet.text,
            inReplyToUserId: tweet.in_reply_to_user_id || null,
            inReplyToTweetId,
            lang: tweet.lang || null,
            source: tweet.source || null,
            contextAnnotationsJson: contextAnnotations,
            metricsJson: JSON.stringify(metrics),
            hasReplies: (metrics.reply_count || 0) > 0,
            hasQuotes: (metrics.quote_count || 0) > 0,
            hasEngagement: ((metrics.reply_count || 0) +
                           (metrics.quote_count || 0) +
                           (metrics.like_count || 0) +
                           (metrics.retweet_count || 0)) > 0,
            isReply,
            isDeleted: false,
            lastSyncedAt: new Date(),
          },
          create: {
            id: tweet.id,
            userId,
            content: tweet.text,
            inReplyToUserId: tweet.in_reply_to_user_id || null,
            inReplyToTweetId,
            lang: tweet.lang || null,
            source: tweet.source || null,
            contextAnnotationsJson: contextAnnotations,
            createdAt: new Date(tweet.created_at),
            metricsJson: JSON.stringify(metrics),
            hasReplies: (metrics.reply_count || 0) > 0,
            hasQuotes: (metrics.quote_count || 0) > 0,
            hasEngagement: ((metrics.reply_count || 0) +
                           (metrics.quote_count || 0) +
                           (metrics.like_count || 0) +
                           (metrics.retweet_count || 0)) > 0,
            isReply,
            isDeleted: false,
            lastSyncedAt: new Date(),
          }
        });

        const existing = await prisma.tweet.count({
          where: { id: tweet.id }
        });

        if (existing > 1) {
          updated++;
        } else {
          stored++;
        }
      } catch (error) {
        logger.error('Failed to store tweet', {
          tweetId: tweet.id,
          userId,
          error: error.message
        });
      }
    }

    return { stored, updated, replies };
  }

  async collectContinuously(username) {
    this.setupShutdownHandlers();
    this.isCollecting = true;
    this.stopRequested = false;
    this.totalCollected = 0;
    this.startTime = Date.now();

    try {
      const user = await this.getOrCreateUser(username);

      // Create collection record
      const collection = await prisma.dataCollection.create({
        data: {
          userId: user.id,
          collectionType: 'tweets',
          status: 'running',
          parametersJson: JSON.stringify({
            continuous: true,
            includeReplies: true,
            excludeRetweets: true
          })
        }
      });

      console.log('\n🚀 Starting continuous collection...');
      console.log('📝 Including all tweets (posts and replies)');
      console.log('⏸️  Press Ctrl+C to stop\n');

      let paginationToken = null;
      let batchNumber = 0;
      const batchSize = 100;

      do {
        if (this.stopRequested) {
          console.log('\n⏹️  Stopping...');
          break;
        }

        batchNumber++;

        try {
          // Show rate limit status every 5 batches
          if (batchNumber % 5 === 0) {
            const status = await rateLimitManager.getStatus();
            const tweetStatus = status.tweets;
            if (tweetStatus) {
              console.log(`📊 Rate: ${tweetStatus.remaining}/${tweetStatus.limit} (resets in ${tweetStatus.secondsUntilReset}s)`);
            }
          }

          console.log(`\n📥 Batch #${batchNumber}...`);

          // Fetch tweets - including replies this time
          const result = await xAPI.getUserTweets(user.twitterUserId, {
            maxResults: batchSize,
            paginationToken,
            excludeReplies: false,  // Include replies
            excludeRetweets: true   // Still exclude retweets
          });

          if (result.data && result.data.length > 0) {
            const oldestTweet = result.data[result.data.length - 1];
            const newestTweet = result.data[0];

            console.log(`   Retrieved ${result.data.length} tweets`);
            console.log(`   Newest: ${new Date(newestTweet.created_at).toLocaleDateString()}`);
            console.log(`   Oldest: ${new Date(oldestTweet.created_at).toLocaleDateString()}`);

            const { stored, updated, replies } = await this.storeTweets(user.id, result.data);
            this.totalCollected += stored;

            // Update collection record
            await prisma.dataCollection.update({
              where: { id: collection.id },
              data: {
                itemsCollected: this.totalCollected
              }
            });

            console.log(`   ✅ Stored: ${stored} new, ${updated} updated, ${replies} replies`);
            console.log(`   📊 Total: ${this.totalCollected} tweets`);
            console.log(`   ⏱️  Time: ${this.getElapsedTime()}`);
          } else {
            console.log(`   ℹ️  No tweets in batch`);
          }

          paginationToken = result.nextToken;

          if (!paginationToken) {
            console.log('\n🎉 Timeline complete - all tweets collected');
            break;
          }

          // Calculate optimal delay
          const optimalDelay = await rateLimitManager.getOptimalDelay('tweets');

          if (optimalDelay > 1000) {
            console.log(`   ⏳ Waiting ${Math.ceil(optimalDelay / 1000)}s...`);
          }

          await new Promise(resolve => setTimeout(resolve, optimalDelay));

        } catch (error) {
          console.error(`\n❌ Error in batch #${batchNumber}:`);
          console.error(`   ${error.message}`);

          if (error.response?.status === 429) {
            const resetTime = error.response?.headers?.['x-rate-limit-reset'];
            if (resetTime) {
              const waitTime = (parseInt(resetTime) * 1000) - Date.now();
              console.log(`   ⏳ Rate limited. Waiting ${Math.ceil(waitTime / 1000)}s...`);
              await new Promise(resolve => setTimeout(resolve, waitTime + 5000));
            } else {
              console.log(`   ⏳ Rate limited. Waiting 60s...`);
              await new Promise(resolve => setTimeout(resolve, 60000));
            }
          } else {
            console.log(`   ⏳ Waiting 10s before retry...`);
            await new Promise(resolve => setTimeout(resolve, 10000));
          }
        }

      } while (paginationToken && !this.stopRequested);

      // Update collection status
      await prisma.dataCollection.update({
        where: { id: collection.id },
        data: {
          status: this.stopRequested ? 'stopped' : 'completed',
          completedAt: new Date(),
          itemsCollected: this.totalCollected
        }
      });

      console.log('\n✅ Collection complete!');
      console.log(`📊 Final: ${this.totalCollected} tweets collected`);
      console.log(`⏱️  Total time: ${this.getElapsedTime()}`);

    } catch (error) {
      console.error('\n❌ Collection failed:');
      console.error(`   ${error.message}`);
      throw error;
    } finally {
      this.isCollecting = false;
      await prisma.$disconnect();
    }
  }
}

// Main execution
async function main() {
  const args = process.argv.slice(2);

  if (args.length === 0) {
    console.log('❌ Error: Please provide a username');
    console.log('\nUsage: node backend/scripts/continuous-collector.js @username');
    console.log('Example: node backend/scripts/continuous-collector.js @naval');
    process.exit(1);
  }

  const username = args[0];

  console.log('═══════════════════════════════════════════════');
  console.log('  📱 X-Agent Continuous Collector');
  console.log('═══════════════════════════════════════════════');
  console.log(`  Target: ${username}`);
  console.log(`  Mode: Unlimited collection`);
  console.log(`  Content: Posts and replies`);
  console.log('═══════════════════════════════════════════════\n');

  const collector = new ContinuousTweetCollector();
  await collector.collectContinuously(username);
}

main().catch(error => {
  console.error('Fatal error:', error);
  process.exit(1);
});
