import express from 'express';
import { requestInspector } from '../services/request-inspector.js';
import { logger } from '../../logger.js';

const router = express.Router();

/**
 * Get all inspection data
 */
router.get('/', (req, res) => {
  try {
    const data = requestInspector.getAll();
    res.json({
      success: true,
      count: data.length,
      data
    });
  } catch (error) {
    logger.error('Failed to retrieve inspection data', { error: error.message });
    res.status(500).json({
      success: false,
      error: error.message
    });
  }
});

/**
 * Get latest inspection entries
 */
router.get('/latest', (req, res) => {
  try {
    const count = parseInt(req.query.count) || 10;
    const data = requestInspector.getLatest(count);
    res.json({
      success: true,
      count: data.length,
      data
    });
  } catch (error) {
    logger.error('Failed to retrieve latest inspection data', { error: error.message });
    res.status(500).json({
      success: false,
      error: error.message
    });
  }
});

/**
 * Get inspection entry by ID
 */
router.get('/:id', (req, res) => {
  try {
    const entry = requestInspector.getById(req.params.id);

    if (!entry) {
      return res.status(404).json({
        success: false,
        error: 'Inspection entry not found'
      });
    }

    res.json({
      success: true,
      data: entry
    });
  } catch (error) {
    logger.error('Failed to retrieve inspection entry', {
      error: error.message,
      id: req.params.id
    });
    res.status(500).json({
      success: false,
      error: error.message
    });
  }
});

/**
 * Get inspection entries by provider
 */
router.get('/provider/:provider', (req, res) => {
  try {
    const data = requestInspector.getByProvider(req.params.provider);
    res.json({
      success: true,
      provider: req.params.provider,
      count: data.length,
      data
    });
  } catch (error) {
    logger.error('Failed to retrieve provider inspection data', {
      error: error.message,
      provider: req.params.provider
    });
    res.status(500).json({
      success: false,
      error: error.message
    });
  }
});

/**
 * Get inspection statistics
 */
router.get('/stats/summary', (req, res) => {
  try {
    const stats = requestInspector.getStats();
    res.json({
      success: true,
      stats
    });
  } catch (error) {
    logger.error('Failed to retrieve inspection stats', { error: error.message });
    res.status(500).json({
      success: false,
      error: error.message
    });
  }
});

/**
 * Clear all inspection data
 */
router.delete('/clear', (req, res) => {
  try {
    requestInspector.clear();
    res.json({
      success: true,
      message: 'Inspection data cleared'
    });
  } catch (error) {
    logger.error('Failed to clear inspection data', { error: error.message });
    res.status(500).json({
      success: false,
      error: error.message
    });
  }
});

export default router;