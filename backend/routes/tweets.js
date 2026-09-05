import { Router } from 'express';
import { PrismaClient } from '@prisma/client';
import { logger } from '../../logger.js';
import { xAPI } from '../lib/twitter-api.js';

const router = Router();
const prisma = new PrismaClient();

// Get tweets for a user
router.get('/user/:userId', async (req, res) => {
  try {
    const { userId } = req.params;
    const {
      limit = 5000, // Increased from 100 to show more tweets
      offset = 0,
      includeReplies = 'true'
    } = req.query;

    const where = { userId };

    // Optionally filter out replies
    // Query params are always strings, so compare as strings
    if (includeReplies === 'false') {
      where.isReply = false;
    }
    // If includeReplies is 'true' or anything else, show all tweets including replies

    const tweets = await prisma.tweet.findMany({
      where,
      orderBy: { createdAt: 'desc' },
      take: parseInt(limit),
      skip: parseInt(offset),
      include: {
        embedding: {
          select: {
            id: true,
            modelName: true,
            createdAt: true
          }
        }
      }
    });

    res.json(tweets);
  } catch (error) {
    logger.error('Failed to get tweets', { error: error.message });
    res.status(500).json({ error: error.message });
  }
});

// Get tweet by ID
router.get('/:tweetId', async (req, res) => {
  try {
    const { tweetId } = req.params;

    const tweet = await prisma.tweet.findUnique({
      where: { id: tweetId },
      include: {
        user: true,
        embedding: true
      }
    });

    if (!tweet) {
      return res.status(404).json({ error: 'Tweet not found' });
    }

    res.json(tweet);
  } catch (error) {
    logger.error('Failed to get tweet', { error: error.message });
    res.status(500).json({ error: error.message });
  }
});

// Get similar tweets
router.get('/:tweetId/similar', async (req, res) => {
  try {
    const { tweetId } = req.params;
    const { limit = 10 } = req.query;

    const similarities = await prisma.tweetSimilarity.findMany({
      where: {
        OR: [
          { tweetId1: tweetId },
          { tweetId2: tweetId }
        ]
      },
      orderBy: { similarity: 'desc' },
      take: parseInt(limit),
      include: {
        tweet1: true,
        tweet2: true
      }
    });

    const similarTweets = similarities.map(s => {
      const otherTweet = s.tweetId1 === tweetId ? s.tweet2 : s.tweet1;
      return {
        ...otherTweet,
        similarity: s.similarity
      };
    });

    res.json(similarTweets);
  } catch (error) {
    logger.error('Failed to get similar tweets', { error: error.message });
    res.status(500).json({ error: error.message });
  }
});

// Get users who liked a specific tweet (OAuth 1.0a user-context)
router.get('/:tweetId/liking-users', async (req, res) => {
  try {
    const { tweetId } = req.params;
    const { paginationToken } = req.query;

    if (!xAPI.hasUserContext()) {
      return res.status(400).json({
        error: 'OAuth 1.0a not configured. Set X_COM_ACCESS_TOKEN and X_COM_ACCESS_TOKEN_SECRET in .env'
      });
    }

    const result = await xAPI.getLikingUsers(tweetId, {
      paginationToken: paginationToken || null,
    });

    res.json(result);
  } catch (error) {
    logger.error('Failed to get liking users', { tweetId: req.params.tweetId, error: error.message });
    const status = error.response?.status || 500;
    res.status(status).json({
      error: error.message,
      detail: error.response?.data
    });
  }
});

// Get tweet statistics for a user
router.get('/stats/:userId', async (req, res) => {
  try {
    const { userId } = req.params;

    const [
      totalTweets,
      posts,
      replies,
      withEmbeddings,
      withEngagement
    ] = await Promise.all([
      prisma.tweet.count({ where: { userId } }),
      prisma.tweet.count({ where: { userId, isReply: false } }),
      prisma.tweet.count({ where: { userId, isReply: true } }),
      prisma.tweet.count({
        where: {
          userId,
          embedding: { isNot: null }
        }
      }),
      prisma.tweet.count({ where: { userId, hasEngagement: true } })
    ]);

    res.json({
      totalTweets,
      posts,
      replies,
      withEmbeddings,
      withEngagement,
      embeddingCoverage: totalTweets > 0 ? (withEmbeddings / totalTweets) : 0
    });
  } catch (error) {
    logger.error('Failed to get tweet stats', { error: error.message });
    res.status(500).json({ error: error.message });
  }
});

export default router;