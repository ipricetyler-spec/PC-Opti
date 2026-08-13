import express from 'express';
import path from 'path';
import dotenv from 'dotenv';
import { GoogleGenAI } from '@google/genai';
import type { SystemScanSnapshot } from './src/types';

dotenv.config();

const app = express();
const PORT = Number(process.env.PORT || 3000);
const HOST = process.env.HOST || '127.0.0.1';

app.use(express.json({ limit: '1mb' }));

app.get('/api/health', (_req, res) => {
  res.json({ status: 'ok', service: 'PC-Opti local audit API', timestamp: new Date().toISOString() });
});

function isSystemScanSnapshot(value: unknown): value is SystemScanSnapshot {
  if (!value || typeof value !== 'object') return false;
  const candidate = value as Partial<SystemScanSnapshot>;
  return candidate.schemaVersion === '1.0.0' &&
    typeof candidate.timestamp === 'string' &&
    typeof candidate.deviceHash === 'string' &&
    Boolean(candidate.metrics) &&
    Boolean(candidate.metadata);
}

app.post('/api/ai/audit', async (req, res) => {
  const snapshot = req.body?.snapshot;
  if (!isSystemScanSnapshot(snapshot)) {
    return res.status(400).json({ success: false, error: 'A valid SystemScanSnapshot schema 1.0.0 is required.' });
  }

  if (!process.env.GEMINI_API_KEY) {
    return res.status(503).json({ success: false, error: 'AI audit is unavailable: GEMINI_API_KEY is not configured.' });
  }

  try {
    const ai = new GoogleGenAI({ apiKey: process.env.GEMINI_API_KEY });
    const prompt = `You are a cautious Windows maintenance analyst. Analyze only the immutable SystemScanSnapshot JSON below.\n\nRules:\n- Never invent measurements, applications, driver versions, temperatures, game installations, benchmark gains, or successful maintenance outcomes.\n- Facts must be directly present in the snapshot and cite their JSON path in brackets, for example [metrics.memory.loadPercentage].\n- Put any judgement or recommendation in inferences or recommendations; it is not a fact.\n- Do not recommend driver changes, RAM cleaners, pagefile changes, registry sweeps, network latency tweaks, service disabling, or one-click optimization.\n- Recommendations may only suggest reviewing startup entries, optionally clearing the observed temporary-file estimate, or optionally running ReTRIM on an SSD when TRIM is enabled.\n- If metadata.errors is non-empty, state that the scan is incomplete and do not infer from unavailable values.\n- Return JSON only using exactly this shape:\n{\n  "facts": ["..."],\n  "inferences": ["..."],\n  "recommendations": [{"title":"...","rationale":"...","action":"REVIEW|OPTIONAL_MAINTENANCE|NO_ACTION"}],\n  "limitations": ["..."]\n}\n\nSystemScanSnapshot:\n${JSON.stringify(snapshot)}`;

    const response = await ai.models.generateContent({
      model: 'gemini-2.5-flash',
      contents: prompt,
      config: { responseMimeType: 'application/json' },
    });
    const text = response.text?.trim();
    if (!text) throw new Error('Gemini returned an empty response.');

    return res.json({ success: true, data: JSON.parse(text), snapshotTimestamp: snapshot.timestamp });
  } catch (error) {
    const message = error instanceof Error ? error.message : 'The AI audit could not be completed.';
    console.error('[PC-Opti] AI audit failed:', message);
    return res.status(502).json({ success: false, error: `AI audit failed: ${message}` });
  }
});

async function startServer() {
  if (process.env.NODE_ENV !== 'production') {
    const { createServer: createViteServer } = await import('vite');
    const vite = await createViteServer({ server: { middlewareMode: true, host: HOST }, appType: 'spa' });
    app.use(vite.middlewares);
  } else {
    const distPath = path.join(process.cwd(), 'dist');
    app.use(express.static(distPath));
    app.get('*', (_req, res) => res.sendFile(path.join(distPath, 'index.html')));
  }

  app.listen(PORT, HOST, () => {
    console.log(`[PC-Opti] Local API listening on http://${HOST}:${PORT}`);
  });
}

startServer();
