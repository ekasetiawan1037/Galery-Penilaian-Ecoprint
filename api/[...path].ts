import type express from 'express';
import { createApiApp } from '../server/app.ts';

const app = createApiApp();

export default function handler(req: express.Request, res: express.Response) {
  return app(req, res);
}
