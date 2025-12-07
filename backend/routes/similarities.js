import { Router } from 'express';
import { PrismaClient } from '@prisma/client';
import { logger } from '../../logger.js';
import similarityService from '../services/similarity-service.js';

const router = Router();
const prisma = new PrismaClient();

// Update similarities for a user
router.post('/update/:userId', async (req, res) => {
  try {
    const { userId } = req.params;

    // Check if update is already running
    const existingJob = await prisma.dataCollection.findFirst({
      where: {
        userId,
        collectionType: 'similarities',
        status: 'running'
      }
    });

    if (existingJob) {
      return res.status(400).json({
        error: 'Similarity calculation already running for this user'
      });
    }

    // Create new job
    const job = await prisma.dataCollection.create({
      data: {
        userId,
        collectionType: 'similarities',
        status: 'pending'
      }
    });

    res.json({
      message: 'Similarity calculation started',
      jobId: job.id
    });

    // Note: In production, trigger the similarity service here

  } catch (error) {
    logger.error('Failed to start similarity calculation', { error: error.message });
    res.status(500).json({ error: error.message });
  }
});

// Get top similar tweets across all users
router.get('/tweets/top', async (req, res) => {
  try {
    const { limit = 50 } = req.query;

    const similarities = await prisma.tweetSimilarity.findMany({
      orderBy: { similarity: 'desc' },
      take: parseInt(limit),
      include: {
        tweet1: {
          include: { user: true }
        },
        tweet2: {
          include: { user: true }
        }
      }
    });

    res.json(similarities);
  } catch (error) {
    logger.error('Failed to get top similar tweets', { error: error.message });
    res.status(500).json({ error: error.message });
  }
});

// Get top similar users
router.get('/users/top', async (req, res) => {
  try {
    const { limit = 20 } = req.query;

    const similarities = await prisma.userSimilarity.findMany({
      orderBy: { similarity: 'desc' },
      take: parseInt(limit),
      include: {
        user1: true,
        user2: true
      }
    });

    res.json(similarities);
  } catch (error) {
    logger.error('Failed to get top similar users', { error: error.message });
    res.status(500).json({ error: error.message });
  }
});

// Get similarity statistics
router.get('/stats', async (req, res) => {
  try {
    const [
      tweetSimilarityCount,
      userSimilarityCount,
      avgTweetSimilarity,
      avgUserSimilarity
    ] = await Promise.all([
      prisma.tweetSimilarity.count(),
      prisma.userSimilarity.count(),
      prisma.tweetSimilarity.aggregate({
        _avg: { similarity: true }
      }),
      prisma.userSimilarity.aggregate({
        _avg: { similarity: true }
      })
    ]);

    const topPairs = await prisma.tweetSimilarity.findMany({
      orderBy: { similarity: 'desc' },
      take: 5,
      select: {
        similarity: true,
        tweet1: {
          select: {
            content: true,
            user: {
              select: { username: true }
            }
          }
        },
        tweet2: {
          select: {
            content: true,
            user: {
              select: { username: true }
            }
          }
        }
      }
    });

    res.json({
      tweetSimilarityCount,
      userSimilarityCount,
      avgTweetSimilarity: avgTweetSimilarity._avg.similarity,
      avgUserSimilarity: avgUserSimilarity._avg.similarity,
      topPairs
    });
  } catch (error) {
    logger.error('Failed to get similarity stats', { error: error.message });
    res.status(500).json({ error: error.message });
  }
});

// Search for similar content
router.post('/search', async (req, res) => {
  try {
    const { text, limit = 10 } = req.body;

    if (!text) {
      return res.status(400).json({ error: 'Text required for search' });
    }

    // Note: In production, this would:
    // 1. Generate embedding for the text
    // 2. Search for similar embeddings
    // 3. Return matching tweets/users

    res.json({
      message: 'Similarity search not yet implemented',
      query: text
    });

  } catch (error) {
    logger.error('Failed to search similarities', { error: error.message });
    res.status(500).json({ error: error.message });
  }
});

// Compare tweets between two users
router.get('/compare/users/:userId1/:userId2', async (req, res) => {
  try {
    const { userId1, userId2 } = req.params;
    const { minSimilarity = 0.7, limit = 50 } = req.query;

    logger.system('Comparing users for similar tweets', { userId1, userId2 });

    // Check both users exist
    const [user1, user2] = await Promise.all([
      prisma.user.findUnique({ where: { id: userId1 } }),
      prisma.user.findUnique({ where: { id: userId2 } })
    ]);

    if (!user1 || !user2) {
      return res.status(404).json({ error: 'One or both users not found' });
    }

    // Find similar tweets
    const similarities = await similarityService.findSimilarTweetsBetweenUsers(
      userId1,
      userId2,
      parseFloat(minSimilarity),
      parseInt(limit)
    );

    // Optionally store high-similarity pairs
    if (similarities.length > 0) {
      await similarityService.storeSimilarities(similarities.slice(0, 20), 'tweet');
    }

    res.json({
      user1: { id: user1.id, username: user1.username },
      user2: { id: user2.id, username: user2.username },
      similarities,
      totalFound: similarities.length,
      minSimilarity: parseFloat(minSimilarity)
    });

  } catch (error) {
    logger.error('Failed to compare users', { error: error.message });
    res.status(500).json({ error: error.message });
  }
});

// Find similar tweets within a single user
router.get('/user/:userId/internal', async (req, res) => {
  try {
    const { userId } = req.params;
    const { minSimilarity = 0.8, limit = 50 } = req.query;

    const user = await prisma.user.findUnique({ where: { id: userId } });
    if (!user) {
      return res.status(404).json({ error: 'User not found' });
    }

    const similarities = await similarityService.findSimilarTweetsForUser(
      userId,
      parseFloat(minSimilarity),
      parseInt(limit)
    );

    res.json({
      user: { id: user.id, username: user.username },
      similarities,
      totalFound: similarities.length,
      minSimilarity: parseFloat(minSimilarity)
    });

  } catch (error) {
    logger.error('Failed to find internal similarities', { error: error.message });
    res.status(500).json({ error: error.message });
  }
});

// Find users with similar content
router.get('/user/:userId/similar-users', async (req, res) => {
  try {
    const { userId } = req.params;
    const { minSimilarity = 0.6, limit = 10 } = req.query;

    const user = await prisma.user.findUnique({ where: { id: userId } });
    if (!user) {
      return res.status(404).json({ error: 'User not found' });
    }

    const similarUsers = await similarityService.findSimilarUsers(
      userId,
      parseFloat(minSimilarity),
      parseInt(limit)
    );

    res.json({
      user: { id: user.id, username: user.username },
      similarUsers,
      totalFound: similarUsers.length,
      minSimilarity: parseFloat(minSimilarity)
    });

  } catch (error) {
    logger.error('Failed to find similar users', { error: error.message });
    res.status(500).json({ error: error.message });
  }
});

export default router;