import { Router } from 'express';
import { register } from '../lib/metrics.js';

const router = Router();

router.get('/', async (req, res) => {
  res.set('Content-Type', register.contentType);
  res.end(await register.metrics());
});

export default router;
