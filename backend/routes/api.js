import { Router } from 'express';
import { xAPI } from '../lib/twitter-api.js';
import { PrismaClient } from '@prisma/client';

const router = Router();
const prisma = new PrismaClient();

// API status endpoint
router.get('/status', async (req, res) => {
  try {
    const apiStatus = await xAPI.testConnection();
    const rateLimits = await xAPI.getRateLimitStatus();

    // Get database stats
    const [userCount, tweetCount, embeddingCount] = await Promise.all([
      prisma.user.count(),
      prisma.tweet.count(),
      prisma.embedding.count()
    ]);

    res.json({
      status: 'operational',
      version: '3.0.0',
      api: apiStatus,
      rateLimits,
      database: {
        users: userCount,
        tweets: tweetCount,
        embeddings: embeddingCount
      },
      timestamp: new Date().toISOString()
    });
  } catch (error) {
    res.status(500).json({
      error: error.message,
      status: 'error'
    });
  }
});

// Get rate limits
router.get('/rate-limits', async (req, res) => {
  try {
    const limits = await xAPI.getRateLimitStatus();
    res.json(limits);
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

// Get settings
router.get('/settings', async (req, res) => {
  try {
    const settings = await prisma.setting.findMany();
    const settingsObj = {};
    settings.forEach(s => {
      settingsObj[s.key] = s.value;
    });
    res.json(settingsObj);
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

// Update setting
router.put('/settings/:key', async (req, res) => {
  try {
    const { key } = req.params;
    const { value } = req.body;

    const setting = await prisma.setting.update({
      where: { key },
      data: { value: String(value) }
    });

    res.json(setting);
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

// Prometheus metrics endpoint (X API + defaults)
router.get('/metrics', async (req, res) => {
  try {
    const { promRegister } = await import('../lib/twitter-api.js');
    res.set('Content-Type', promRegister.contentType);
    res.end(await promRegister.metrics());
  } catch (error) {
    logger.error('Metrics endpoint error', { error: error.message });
    res.status(500).json({ error: 'Metrics unavailable - check prom-client installation' });
  }
});

// Search tweets endpoint
router.get('/search', async (req, res) => {
  try {
    const { q: query, max_results = 100, tweet_fields } = req.query;

    if (!query) {
      return res.status(400).json({ error: 'Query parameter "q" is required' });
    }

    const options = {
      maxResults: parseInt(max_results),
      tweetFields: tweet_fields ? tweet_fields.split(',') : undefined
    };

    const results = await xAPI.searchTweets(query, options);

    res.json(results);
  } catch (error) {
    logger.error('Search endpoint error', { error: error.message, query: req.query.q });
    res.status(500).json({ error: error.message });
  }
});

export default router;