import express from 'express';
import cors from 'cors';
import helmet from 'helmet';
import compression from 'compression';
import dotenv from 'dotenv';
import { PrismaClient } from '@prisma/client';
import { logger } from '../logger.js';

// Import routes
import apiRoutes from './routes/api.js';
import userRoutes from './routes/users.js';
import tweetRoutes from './routes/tweets.js';
import embeddingRoutes from './routes/embeddings.js';
import similarityRoutes from './routes/similarities.js';
import grokRoutes from './routes/grok.js';
import inspectionRoutes from './routes/inspection.js';
import { collectionService } from './services/collection-service.js';

// Load environment variables
dotenv.config();
dotenv.config({ path: '../.env' });

// Initialize Prisma
const prisma = new PrismaClient({
  log: process.env.NODE_ENV === 'development' ? ['error', 'warn'] : ['error']
});

// Create Express app
const app = express();
const PORT = process.env.BACKEND_PORT || 3001;

// Middleware
app.use(helmet({
  contentSecurityPolicy: false,
  crossOriginEmbedderPolicy: false
}));
app.use(compression());
app.use(cors({
  origin: (process.env.CORS_ORIGINS || (process.env.NODE_ENV === 'production' ? 'https://yourdomain.com' : 'http://localhost:1122,http://127.0.0.1:1122')).split(',').map(o => o.trim()).filter(Boolean),
  credentials: true
}));
app.use(express.json({ limit: '50mb' }));
app.use(express.urlencoded({ extended: true, limit: '50mb' }));

// Request logging middleware
app.use((req, res, next) => {
  const start = Date.now();
  res.on('finish', () => {
    const duration = Date.now() - start;
    if (duration > 1000) {
      logger.warn('Slow request', {
        method: req.method,
        url: req.url,
        status: res.statusCode,
        duration
      });
    }
  });
  next();
});

// Health check endpoint
app.get('/health', (req, res) => {
  res.json({
    status: 'healthy',
    timestamp: new Date().toISOString(),
    uptime: process.uptime(),
    memory: process.memoryUsage(),
    version: '3.0.0'
  });
});

// API routes
app.use('/api', apiRoutes);
app.use('/api/users', userRoutes);
app.use('/api/tweets', tweetRoutes);
app.use('/api/embeddings', embeddingRoutes);
app.use('/api/similarities', similarityRoutes);
app.use('/api/grok', grokRoutes);
app.use('/api/inspection', inspectionRoutes);

// Error handling middleware
app.use((err, req, res, next) => {
  logger.error('Unhandled error', {
    error: err.message,
    stack: err.stack,
    url: req.url,
    method: req.method
  });

  res.status(err.status || 500).json({
    error: {
      message: err.message || 'Internal server error',
      status: err.status || 500
    }
  });
});

// 404 handler
app.use((req, res) => {
  res.status(404).json({
    error: {
      message: 'Not found',
      status: 404
    }
  });
});

// Handle interrupted collections on startup
async function handleInterruptedCollections() {
  try {
    logger.system('Checking for interrupted collections...');

    // Find all collections that are stuck in 'running' status
    const stuckCollections = await prisma.dataCollection.findMany({
      where: {
        status: 'running'
      }
    });

    if (stuckCollections.length > 0) {
      logger.warn(`Found ${stuckCollections.length} interrupted collections`, {
        collections: stuckCollections.map(c => ({
          id: c.id,
          userId: c.userId,
          type: c.collectionType,
          startedAt: c.startedAt
        }))
      });

      // Mark collections as interrupted based on age
      const now = new Date();
      const oneHourAgo = new Date(now.getTime() - 60 * 60 * 1000);

      for (const collection of stuckCollections) {
        const age = now.getTime() - new Date(collection.startedAt).getTime();
        const ageMinutes = Math.floor(age / 60000);

        // If collection is older than 1 hour, mark as failed
        if (collection.startedAt < oneHourAgo) {
          await prisma.dataCollection.update({
            where: { id: collection.id },
            data: {
              status: 'interrupted',
              completedAt: now,
              errorMessage: `Collection interrupted due to server restart after ${ageMinutes} minutes`
            }
          });
          logger.system(`Marked old collection ${collection.id} as interrupted (age: ${ageMinutes} minutes)`);
        } else {
          // For recent collections, mark as resumable
          await prisma.dataCollection.update({
            where: { id: collection.id },
            data: {
              status: 'interrupted',
              errorMessage: `Collection interrupted due to server restart. Can be resumed.`
            }
          });
          logger.system(`Marked recent collection ${collection.id} as interrupted (age: ${ageMinutes} minutes, resumable)`);
        }
      }

      logger.system(`Cleaned up ${stuckCollections.length} interrupted collections`);
    } else {
      logger.system('No interrupted collections found');
    }
  } catch (error) {
    logger.error('Failed to handle interrupted collections', {
      error: error.message,
      stack: error.stack
    });
    // Don't exit - this is a recovery mechanism, not critical for startup
  }
}

// Start server
async function startServer() {
  try {
    // Test database connection
    await prisma.$connect();
    logger.system('Database connected successfully');

    // Initialize settings if needed
    const settingCount = await prisma.setting.count();
    if (settingCount === 0) {
      await prisma.setting.createMany({
        data: [
          { key: 'version', value: '3.0.0', type: 'string', description: 'Application version' },
          { key: 'embeddings_enabled', value: 'true', type: 'boolean', description: 'Enable automatic embeddings' },
          { key: 'similarity_enabled', value: 'true', type: 'boolean', description: 'Enable similarity calculations' },
          { key: 'auto_collect', value: 'false', type: 'boolean', description: 'Enable automatic collection' }
        ]
      });
      logger.system('Default settings initialized');
    }

    // Handle any interrupted collections from previous server run
    await handleInterruptedCollections();

    // Set up periodic cleanup for stale collections (every 15 minutes)
    const cleanupInterval = setInterval(async () => {
      try {
        logger.system('Running periodic collection cleanup...');
        const result = await collectionService.cleanupStaleCollections();
        if (result.cleaned > 0) {
          logger.system(`Cleaned up ${result.cleaned} stale collections`);
        }
      } catch (error) {
        logger.error('Periodic cleanup failed', { error: error.message });
      }
    }, 15 * 60 * 1000); // 15 minutes

    // Store interval ID for cleanup on shutdown
    global.cleanupInterval = cleanupInterval;

    // Start server
    app.listen(PORT, () => {
      logger.system(`X-Agent Backend started on port ${PORT}`, {
        environment: process.env.NODE_ENV || 'development',
        port: PORT,
        apiTier: process.env.API_TIER || 'basic',
        features: {
          collectionRecovery: true,
          periodicCleanup: '15 minutes'
        }
      });
    });
  } catch (error) {
    logger.error('Failed to start server', { error: error.message });
    process.exit(1);
  }
}

// Handle shutdown gracefully
process.on('SIGTERM', async () => {
  logger.system('SIGTERM received, shutting down gracefully...');
  if (global.cleanupInterval) {
    clearInterval(global.cleanupInterval);
  }
  await prisma.$disconnect();
  process.exit(0);
});

process.on('SIGINT', async () => {
  logger.system('SIGINT received, shutting down gracefully...');
  if (global.cleanupInterval) {
    clearInterval(global.cleanupInterval);
  }
  await prisma.$disconnect();
  process.exit(0);
});

// Start the server
startServer();
