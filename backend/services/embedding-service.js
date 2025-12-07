import { pipeline } from '@xenova/transformers';
import { PrismaClient } from '@prisma/client';
import { logger } from '../../logger.js';
import { config } from '../config.js';

const prisma = new PrismaClient();

// Initialize embedding pipeline
let embedder = null;

// Clean tweet text by removing @mentions and optionally URLs
function cleanTweetText(text) {
  let cleaned = text;

  // Remove @mentions if configured
  if (config.embeddings.filtering.removeAtMentions) {
    // Remove @username patterns (handles usernames with letters, numbers, underscores)
    cleaned = cleaned.replace(/@[A-Za-z0-9_]+/g, '').trim();
  }

  // Remove URLs if configured
  if (config.embeddings.filtering.removeUrls) {
    // Remove URLs (http/https links)
    cleaned = cleaned.replace(/https?:\/\/[^\s]+/g, '').trim();
    // Remove shortened URLs that don't have protocol
    cleaned = cleaned.replace(/t\.co\/[^\s]+/g, '').trim();
  }

  // Remove extra spaces that may have been created
  cleaned = cleaned.replace(/\s+/g, ' ').trim();

  return cleaned;
}

// Check if a tweet should be processed for embedding
function shouldProcessTweet(tweet) {
  // Check if it's a reply and we're excluding replies
  if (config.embeddings.filtering.excludeReplies && tweet.isReply) {
    return false;
  }

  // Clean the text first to check actual content length
  const cleanedText = cleanTweetText(tweet.content);

  // Check minimum character length after cleaning
  if (cleanedText.length < config.embeddings.filtering.minCharacterLength) {
    return false;
  }

  return true;
}

async function getEmbedder() {
  if (!embedder) {
    logger.system('Initializing embedding model', {
      model: config.embeddings.model
    });

    embedder = await pipeline('feature-extraction', config.embeddings.model);

    logger.system('Embedding model loaded successfully');
  }
  return embedder;
}

// Generate embedding for a single text
async function generateEmbedding(text) {
  try {
    const model = await getEmbedder();

    // Generate embedding
    const output = await model(text, {
      pooling: 'mean',
      normalize: true
    });

    // Convert to array and flatten
    const embedding = Array.from(output.data);

    return embedding;
  } catch (error) {
    logger.error('Failed to generate embedding', {
      error: error.message,
      text: text.substring(0, 100)
    });
    throw error;
  }
}

// Process embeddings for a user's tweets
export async function processUserTweetEmbeddings(userId, jobId) {
  try {
    logger.system('Starting embedding generation for user', { userId, jobId });

    // Update job status to running
    await prisma.dataCollection.update({
      where: { id: jobId },
      data: {
        status: 'running',
        startedAt: new Date()
      }
    });

    // Get ALL tweets without embeddings (no limit)
    const tweets = await prisma.tweet.findMany({
      where: {
        userId,
        embedding: null
      },
      select: {
        id: true,
        content: true,
        isReply: true,
        createdAt: true
      },
      orderBy: {
        createdAt: 'desc'
      }
      // Removed take limit - process ALL tweets at once
    });

    if (tweets.length === 0) {
      logger.system('No tweets to process for embeddings', { userId });

      await prisma.dataCollection.update({
        where: { id: jobId },
        data: {
          status: 'completed',
          completedAt: new Date(),
          itemsCollected: 0,
          parametersJson: JSON.stringify({ message: 'No tweets to process' })
        }
      });

      return { processed: 0, total: 0 };
    }

    // Filter tweets based on configuration
    const tweetsToProcess = tweets.filter(shouldProcessTweet);
    const skipped = tweets.length - tweetsToProcess.length;

    if (tweetsToProcess.length === 0) {
      logger.system('No tweets meet criteria for embeddings', {
        userId,
        totalTweets: tweets.length,
        skipped,
        filteringConfig: config.embeddings.filtering
      });

      await prisma.dataCollection.update({
        where: { id: jobId },
        data: {
          status: 'completed',
          completedAt: new Date(),
          itemsCollected: 0,
          parametersJson: JSON.stringify({
            message: 'No tweets met filtering criteria',
            totalTweets: tweets.length,
            skipped,
            filteringConfig: config.embeddings.filtering
          })
        }
      });

      return { processed: 0, total: tweets.length, skipped };
    }

    logger.system(`Processing ${tweetsToProcess.length} tweets for embeddings (${skipped} skipped)`, {
      userId,
      totalTweets: tweets.length,
      tweetsToProcess: tweetsToProcess.length,
      skipped
    });

    let processed = 0;
    const errors = [];

    // Process tweets in batches
    for (const tweet of tweetsToProcess) {
      try {
        // Clean the tweet text before generating embedding
        const cleanedText = cleanTweetText(tweet.content);

        // Generate embedding for cleaned tweet content
        const embeddingVector = await generateEmbedding(cleanedText);

        // Store embedding in database
        // Convert array to Buffer for storage
        const vectorBuffer = Buffer.from(new Float32Array(embeddingVector).buffer);

        await prisma.embedding.upsert({
          where: { tweetId: tweet.id },
          create: {
            tweetId: tweet.id,
            vector: vectorBuffer,
            modelName: config.embeddings.model,
            vectorDim: embeddingVector.length,
            cleanedText: cleanedText
          },
          update: {
            vector: vectorBuffer,
            modelName: config.embeddings.model,
            vectorDim: embeddingVector.length,
            cleanedText: cleanedText
          }
        });

        processed++;

        // Log progress every 25 tweets (or every 10 if less than 100 total)
        const logInterval = tweetsToProcess.length > 100 ? 25 : 10;
        if (processed % logInterval === 0) {
          const percentage = Math.round((processed / tweetsToProcess.length) * 100);
          logger.system(`Embedding progress: ${processed}/${tweetsToProcess.length} (${percentage}%)`, { userId });
        }

        // Add small delay every 10 tweets to avoid overwhelming the system
        if (processed % 10 === 0) {
          await new Promise(resolve => setTimeout(resolve, 50)); // Reduced delay
        }

      } catch (error) {
        logger.error('Failed to process tweet embedding', {
          tweetId: tweet.id,
          error: error.message
        });
        errors.push({
          tweetId: tweet.id,
          error: error.message
        });
      }
    }

    // Update job status
    await prisma.dataCollection.update({
      where: { id: jobId },
      data: {
        status: errors.length === tweetsToProcess.length ? 'failed' : 'completed',
        completedAt: new Date(),
        itemsCollected: processed,
        parametersJson: JSON.stringify({
          totalTweets: tweets.length,
          processed,
          skipped,
          errors: errors.length,
          errorDetails: errors.length > 0 ? errors : undefined,
          filteringConfig: config.embeddings.filtering
        })
      }
    });

    logger.system('Embedding generation completed', {
      userId,
      processed,
      total: tweets.length,
      skipped,
      errors: errors.length
    });

    // Generate user embedding from tweet embeddings
    await generateUserEmbedding(userId);

    return {
      processed,
      total: tweets.length,
      skipped,
      errors: errors.length
    };

  } catch (error) {
    logger.error('Failed to process user tweet embeddings', {
      userId,
      jobId,
      error: error.message
    });

    // Update job status to failed
    await prisma.dataCollection.update({
      where: { id: jobId },
      data: {
        status: 'failed',
        completedAt: new Date(),
        errorMessage: error.message,
        parametersJson: JSON.stringify({ error: error.message })
      }
    });

    throw error;
  }
}

// Generate aggregate embedding for a user based on their tweets
async function generateUserEmbedding(userId) {
  try {
    // Get ALL tweet embeddings for the user (no limit)
    const embeddings = await prisma.embedding.findMany({
      where: {
        tweet: { userId }
      },
      select: {
        vector: true
      }
      // Removed take limit - use ALL embeddings for user profile
    });

    if (embeddings.length === 0) {
      logger.system('No tweet embeddings found for user embedding', { userId });
      return null;
    }

    // Convert first vector from Buffer to array to get dimension
    const firstVector = new Float32Array(embeddings[0].vector.buffer, embeddings[0].vector.byteOffset, embeddings[0].vector.byteLength / 4);
    const dimension = firstVector.length;
    const avgEmbedding = new Array(dimension).fill(0);

    // Process all embeddings
    for (const { vector } of embeddings) {
      const floatArray = new Float32Array(vector.buffer, vector.byteOffset, vector.byteLength / 4);
      for (let i = 0; i < dimension; i++) {
        avgEmbedding[i] += floatArray[i];
      }
    }

    for (let i = 0; i < dimension; i++) {
      avgEmbedding[i] /= embeddings.length;
    }

    // Normalize the embedding
    const magnitude = Math.sqrt(avgEmbedding.reduce((sum, val) => sum + val * val, 0));
    const normalizedEmbedding = avgEmbedding.map(val => val / magnitude);

    // Convert to Buffer for storage
    const vectorBuffer = Buffer.from(new Float32Array(normalizedEmbedding).buffer);

    // Store user embedding
    await prisma.userEmbedding.upsert({
      where: { userId },
      create: {
        userId,
        vector: vectorBuffer,
        modelName: config.embeddings.model,
        vectorDim: dimension,
        tweetCount: embeddings.length
      },
      update: {
        vector: vectorBuffer,
        modelName: config.embeddings.model,
        vectorDim: dimension,
        tweetCount: embeddings.length
      }
    });

    logger.system('User embedding generated successfully', {
      userId,
      tweetCount: embeddings.length
    });

    return normalizedEmbedding;

  } catch (error) {
    logger.error('Failed to generate user embedding', {
      userId,
      error: error.message
    });
    throw error;
  }
}

// Get job status
export async function getJobStatus(jobId) {
  try {
    const job = await prisma.dataCollection.findUnique({
      where: { id: jobId }
    });

    return job;
  } catch (error) {
    logger.error('Failed to get job status', {
      jobId,
      error: error.message
    });
    throw error;
  }
}

export default {
  processUserTweetEmbeddings,
  generateEmbedding,
  getJobStatus
};