import { PrismaClient } from '@prisma/client';
import { logger } from '../../logger.js';
import { config, currentRateLimits } from '../config.js';

const prisma = new PrismaClient();

class RateLimitManager {
  constructor() {
    this.limits = new Map();
    this.rateLimitPauses = new Map();
    logger.system('Rate Limit Manager initialized', { limits: currentRateLimits });
  }

  async checkAndWait(endpoint) {
    if (config.rateLimits.tier === 'enterprise') {
      logger.api('Bypassing rate limit check for enterprise tier', { endpoint });
      return;
    }

    const now = Date.now();
    const limit = currentRateLimits[endpoint];

    if (!limit) {
      logger.error('Unknown endpoint for rate limiting', { endpoint });
      throw new Error(`Unknown endpoint: ${endpoint}`);
    }

    let rateLimitRecord = await prisma.rateLimit.findUnique({
      where: { endpoint }
    });

    if (!rateLimitRecord) {
      rateLimitRecord = await prisma.rateLimit.create({
        data: {
          endpoint,
          remaining: limit.requests,
          resetTime: new Date(now + limit.window * 1000),
          used: 0,
          limit: limit.requests
        }
      });
    }

    const resetTime = rateLimitRecord.resetTime.getTime();

    // Check if reset time has passed
    if (now >= resetTime) {
      rateLimitRecord = await prisma.rateLimit.update({
        where: { endpoint },
        data: {
          remaining: limit.requests,
          resetTime: new Date(now + limit.window * 1000),
          used: 0
        }
      });
      this.rateLimitPauses.delete(endpoint);
      logger.api('Rate limit reset', { endpoint, newResetTime: rateLimitRecord.resetTime });
    }

    // Check if we have requests remaining
    if (rateLimitRecord.remaining <= 0) {
      const waitTime = resetTime - now;

      this.rateLimitPauses.set(endpoint, {
        pausedAt: new Date(),
        resumesAt: new Date(now + waitTime),
        reason: 'rate_limit_exceeded'
      });

      logger.api('Rate limit exceeded, waiting', {
        endpoint,
        waitTime: Math.ceil(waitTime / 1000)
      });

      if (waitTime > 0) {
        await new Promise(resolve => setTimeout(resolve, waitTime));
        return this.checkAndWait(endpoint);
      }
    }

    // Clear pause status
    this.rateLimitPauses.delete(endpoint);

    // We can make the request
    await prisma.rateLimit.update({
      where: { endpoint },
      data: {
        remaining: rateLimitRecord.remaining - 1,
        used: rateLimitRecord.used + 1
      }
    });

    logger.api('Rate limit check passed', {
      endpoint,
      remaining: rateLimitRecord.remaining - 1
    });
  }

  async updateLimits(endpoint, headers) {
    const remaining = parseInt(headers['x-rate-limit-remaining']) || 0;
    const resetTime = parseInt(headers['x-rate-limit-reset']) || 0;
    const limit = parseInt(headers['x-rate-limit-limit']) || 0;

    if (remaining !== undefined && resetTime && limit) {
      await prisma.rateLimit.upsert({
        where: { endpoint },
        update: {
          remaining,
          resetTime: new Date(resetTime * 1000),
          limit
        },
        create: {
          endpoint,
          remaining,
          resetTime: new Date(resetTime * 1000),
          used: limit - remaining,
          limit
        }
      });

      logger.api('Rate limits updated from headers', {
        endpoint,
        remaining,
        resetTime: new Date(resetTime * 1000)
      });
    }
  }

  async getOptimalDelay(endpoint) {
    if (config.rateLimits.tier === 'enterprise') {
      logger.api('Returning zero delay for enterprise tier', { endpoint });
      return 0;
    }

    const limit = currentRateLimits[endpoint];
    if (!limit) return 1000;

    const rateLimitRecord = await prisma.rateLimit.findUnique({
      where: { endpoint }
    });

    if (!rateLimitRecord) return 1000;

    const now = Date.now();
    const resetTime = rateLimitRecord.resetTime.getTime();
    const timeUntilReset = resetTime - now;

    if (timeUntilReset <= 0) return 100;

    const requestsRemaining = rateLimitRecord.remaining;
    if (requestsRemaining <= 0) return timeUntilReset;

    const optimalDelay = Math.max(100, timeUntilReset / requestsRemaining);

    logger.api('Calculated optimal delay', {
      endpoint,
      delay: Math.ceil(optimalDelay),
      remaining: requestsRemaining
    });

    return optimalDelay;
  }

  async hasQuota(endpoint) {
    if (config.rateLimits.tier === 'enterprise') {
      return true;
    }

    const now = Date.now();
    const limit = currentRateLimits[endpoint];

    if (!limit) return false;

    const rateLimitRecord = await prisma.rateLimit.findUnique({
      where: { endpoint }
    });

    if (!rateLimitRecord) return true;

    const resetTime = rateLimitRecord.resetTime.getTime();
    if (now >= resetTime) return true;

    return rateLimitRecord.remaining > 0;
  }

  async getStatus() {
    const records = await prisma.rateLimit.findMany();
    const status = {};

    for (const record of records) {
      const now = Date.now();
      const resetTime = record.resetTime.getTime();
      const pauseInfo = this.rateLimitPauses.get(record.endpoint);

      status[record.endpoint] = {
        remaining: record.remaining,
        used: record.used,
        limit: record.limit,
        resetTime: record.resetTime,
        secondsUntilReset: Math.max(0, Math.ceil((resetTime - now) / 1000)),
        isPaused: !!pauseInfo
      };
    }

    return status;
  }

  async reset() {
    await prisma.rateLimit.deleteMany({});
    this.rateLimitPauses.clear();
    logger.api('All rate limits reset');
  }
}

export const rateLimitManager = new RateLimitManager();
