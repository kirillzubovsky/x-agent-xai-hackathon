import { Router } from 'express';
import { PrismaClient } from '@prisma/client';
import { logger } from '../../logger.js';
import { processUserTweetEmbeddings, getJobStatus } from '../services/embedding-service.js';

const router = Router();
const prisma = new PrismaClient();

// Process embeddings for a user's tweets
router.post('/process/:userId', async (req, res) => {
  try {
    const { userId } = req.params;

    // Check if processing is already running
    const existingJob = await prisma.dataCollection.findFirst({
      where: {
        userId,
        collectionType: 'embeddings',
        status: 'running'
      }
    });

    if (existingJob) {
      return res.status(400).json({
        error: 'Embedding generation already running for this user'
      });
    }

    // Create new job
    const job = await prisma.dataCollection.create({
      data: {
        userId,
        collectionType: 'embeddings',
        status: 'pending'
      }
    });

    res.json({
      message: 'Embedding generation started',
      jobId: job.id
    });

    // Process embeddings asynchronously
    processUserTweetEmbeddings(userId, job.id).catch(error => {
      logger.error('Embedding processing failed', {
        userId,
        jobId: job.id,
        error: error.message
      });
    });

  } catch (error) {
    logger.error('Failed to start embedding generation', { error: error.message });
    res.status(500).json({ error: error.message });
  }
});

// Get embedding job status
router.get('/status/:jobId', async (req, res) => {
  try {
    const { jobId } = req.params;
    const job = await getJobStatus(jobId);

    if (!job) {
      return res.status(404).json({ error: 'Job not found' });
    }

    res.json(job);
  } catch (error) {
    logger.error('Failed to get job status', { error: error.message });
    res.status(500).json({ error: error.message });
  }
});

// Get embedding for a tweet
router.get('/tweet/:tweetId', async (req, res) => {
  try {
    const { tweetId } = req.params;

    const embedding = await prisma.embedding.findUnique({
      where: { tweetId },
      include: { tweet: true }
    });

    if (!embedding) {
      return res.status(404).json({ error: 'Embedding not found' });
    }

    res.json(embedding);
  } catch (error) {
    logger.error('Failed to get embedding', { error: error.message });
    res.status(500).json({ error: error.message });
  }
});

// Get user embedding
router.get('/user/:userId', async (req, res) => {
  try {
    const { userId } = req.params;

    const userEmbedding = await prisma.userEmbedding.findUnique({
      where: { userId },
      include: { user: true }
    });

    if (!userEmbedding) {
      return res.status(404).json({ error: 'User embedding not found' });
    }

    res.json(userEmbedding);
  } catch (error) {
    logger.error('Failed to get user embedding', { error: error.message });
    res.status(500).json({ error: error.message });
  }
});

// Get embedding statistics
router.get('/stats/:userId', async (req, res) => {
  try {
    const { userId } = req.params;

    const [
      totalTweets,
      tweetsWithEmbeddings,
      hasUserEmbedding
    ] = await Promise.all([
      prisma.tweet.count({ where: { userId } }),
      prisma.tweet.count({
        where: {
          userId,
          embedding: { isNot: null }
        }
      }),
      prisma.userEmbedding.count({ where: { userId } })
    ]);

    const latestEmbedding = await prisma.embedding.findFirst({
      where: {
        tweet: { userId }
      },
      orderBy: { createdAt: 'desc' },
      select: {
        createdAt: true,
        modelName: true,
        vectorDim: true
      }
    });

    res.json({
      totalTweets,
      tweetsWithEmbeddings,
      coverage: totalTweets > 0 ? (tweetsWithEmbeddings / totalTweets) : 0,
      hasUserEmbedding: hasUserEmbedding > 0,
      latestEmbedding
    });
  } catch (error) {
    logger.error('Failed to get embedding stats', { error: error.message });
    res.status(500).json({ error: error.message });
  }
});

export default router;