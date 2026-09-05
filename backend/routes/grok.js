import { Router } from 'express';
import { PrismaClient } from '@prisma/client';
import { logger } from '../../logger.js';
import { config } from '../config.js';
import { AIProviderFactory } from '../services/ai-providers/index.js';
import { findTopTweetsByUserEmbedding } from '../services/similarity-service.js';

const router = Router();
const prisma = new PrismaClient();

// Initialize AI provider
let aiProvider = null;
try {
  aiProvider = AIProviderFactory.getProvider(config);
  logger.system('AI Provider initialized', {
    provider: aiProvider.name,
    model: aiProvider.model,
    configured: aiProvider.isConfigured()
  });
} catch (error) {
  logger.error('Failed to initialize AI provider', { error: error.message });
}

// Chat with Grok using context from loaded users
router.post('/ask', async (req, res) => {
  try {
    const { message, userIds = [], includeEmbeddings = false, includeFollowers = false } = req.body;

    if (!message) {
      return res.status(400).json({ error: 'Message required' });
    }

    // Check if AI provider is initialized
    if (!aiProvider || !aiProvider.isConfigured()) {
      return res.status(503).json({
        error: 'AI service not configured. Add XAI_API_KEY, OPENAI_API_KEY, or run Ollama locally'
      });
    }

    // Gather context from specified users
    const context = {
      users: [],
      tweets: [],
      similarityTweets: [],
      embeddings: [],
      followers: []
    };

    for (const userId of userIds) {
      const user = await prisma.user.findUnique({
        where: { id: userId }
      });

      if (user) {
        context.users.push(user);

        // Get recent tweets (300 per user)
        const tweets = await prisma.tweet.findMany({
          where: { userId },
          orderBy: { createdAt: 'desc' },
          take: 300
        });
        context.tweets.push(...tweets);

        // Get top 20 tweets by embedding similarity
        try {
          const topSimilarityTweets = await findTopTweetsByUserEmbedding(userId, 20);
          context.similarityTweets.push(...topSimilarityTweets.map(item => item.tweet));
        } catch (error) {
          logger.error('Failed to get similarity tweets', { userId, error: error.message });
        }

        // Get embeddings if requested
        if (includeEmbeddings) {
          const userEmbedding = await prisma.userEmbedding.findUnique({
            where: { userId }
          });
          if (userEmbedding) {
            context.embeddings.push(userEmbedding);
          }
        }

        // Get followers if requested
        if (includeFollowers) {
          const relations = await prisma.followerRelation.findMany({
            where: { userId },
            include: {
              follower: {
                select: {
                  username: true,
                  displayName: true,
                  description: true,
                  followersCount: true,
                  tweetCount: true,
                  verified: true,
                  verifiedType: true,
                }
              }
            },
            orderBy: { follower: { followersCount: 'desc' } },
            take: 2000
          });
          context.followers.push(...relations.map(r => ({
            ...r.follower,
            followsUser: user.username
          })));
        }
      }
    }

    // Call the AI provider with the message and context
    logger.system('Processing AI request', {
      provider: aiProvider.name,
      userCount: context.users.length,
      tweetCount: context.tweets.length,
      similarityTweetCount: context.similarityTweets.length,
      embeddingCount: context.embeddings.length,
      followerCount: context.followers.length
    });

    // Get the AI response
    const aiResponse = await aiProvider.ask(message, context);

    // Return the response to the frontend
    res.json(aiResponse);

  } catch (error) {
    logger.error('Failed to process Grok request', { error: error.message });
    res.status(500).json({ error: error.message });
  }
});

// Generate image using Grok Imagine API
router.post('/generate-image', async (req, res) => {
  try {
    const { prompt, options = {} } = req.body;

    if (!prompt) {
      return res.status(400).json({ error: 'Prompt required for image generation' });
    }

    // Force use Grok provider for image generation
    let imageProvider;
    try {
      imageProvider = AIProviderFactory.getProviderByName('grok', config);
    } catch (providerError) {
      logger.error('Failed to initialize Grok provider for image gen', { error: providerError.message });
      return res.status(503).json({ 
        error: 'Grok provider not available. Ensure XAI_API_KEY is set and Grok supports image generation.' 
      });
    }

    if (!imageProvider.supportsImageGen) {
      return res.status(503).json({ error: 'Grok image generation not supported in current configuration.' });
    }

    logger.system('Generating image with Grok Imagine', { 
      prompt: prompt.substring(0, 100) + (prompt.length > 100 ? '...' : ''),
      options 
    });

    const result = await imageProvider.generateImage(prompt, options);

    res.json(result);

  } catch (error) {
    logger.error('Failed to generate image with Grok', { error: error.message });
    res.status(500).json({ error: error.message });
  }
});

// Edit image using Grok Imagine API
router.post('/edit-image', async (req, res) => {
  try {
    const { image, prompt, options = {} } = req.body;

    if (!image || !prompt) {
      return res.status(400).json({ error: 'Both image (URL or base64 data URI) and prompt required for image editing' });
    }

    // Force use Grok provider for image editing
    let imageProvider;
    try {
      imageProvider = AIProviderFactory.getProviderByName('grok', config);
    } catch (providerError) {
      logger.error('Failed to initialize Grok provider for image edit', { error: providerError.message });
      return res.status(503).json({ 
        error: 'Grok provider not available for editing. Ensure XAI_API_KEY is set.' 
      });
    }

    if (!imageProvider.supportsImageEdit) {
      return res.status(503).json({ error: 'Grok image editing not supported in current configuration.' });
    }

    logger.system('Editing image with Grok Imagine', { 
      prompt: prompt.substring(0, 100) + (prompt.length > 100 ? '...' : ''),
      imageType: image.startsWith('data:') ? 'base64' : 'url',
      options 
    });

    const result = await imageProvider.editImage(image, prompt, options);

    res.json(result);

  } catch (error) {
    logger.error('Failed to edit image with Grok', { error: error.message });
    res.status(500).json({ error: error.message });
  }
});

// Get suggested queries based on loaded data
router.get('/suggestions', async (req, res) => {
  try {
    const { userIds = [] } = req.query;

    const suggestions = [
      'What are the main topics these users tweet about?',
      'Find common interests between these users',
      'What makes these users\' content similar?',
      'Summarize the key insights from these tweets',
      'What questions do these users frequently ask?',
      'What are the most engaging topics?'
    ];

    // Add user-specific suggestions if userIds provided
    if (userIds.length > 0) {
      const users = await prisma.user.findMany({
        where: { id: { in: userIds } },
        select: { username: true }
      });

      const usernames = users.map(u => u.username).join(', ');
      suggestions.push(
        `Compare the writing styles of ${usernames}`,
        `What differentiates ${usernames} from each other?`
      );
    }

    res.json(suggestions);
  } catch (error) {
    logger.error('Failed to get suggestions', { error: error.message });
    res.status(500).json({ error: error.message });
  }
});

// Get conversation history
router.get('/history', async (req, res) => {
  try {
    // Note: In production, this would retrieve from a conversations table
    res.json({
      conversations: [],
      message: 'Conversation history not yet implemented'
    });
  } catch (error) {
    logger.error('Failed to get conversation history', { error: error.message });
    res.status(500).json({ error: error.message });
  }
});

// Get current AI provider information
router.get('/provider', async (req, res) => {
  try {
    if (!aiProvider) {
      return res.status(503).json({
        error: 'No AI provider configured'
      });
    }

    const providerInfo = aiProvider.getInfo();
    const availableProviders = AIProviderFactory.getAvailableProviders(config);

    res.json({
      current: providerInfo,
      available: availableProviders,
      configuredVia: process.env.AI_PROVIDER ? 'AI_PROVIDER env var' : 'auto-detected'
    });
  } catch (error) {
    logger.error('Failed to get provider info', { error: error.message });
    res.status(500).json({ error: error.message });
  }
});

export default router;