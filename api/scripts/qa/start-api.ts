/** Starts the API against the QA database with the capture WhatsApp transport. Run: npm run qa:api */
import { applyQaEnv } from './env.js';

applyQaEnv();
await import('../../src/index.js');
