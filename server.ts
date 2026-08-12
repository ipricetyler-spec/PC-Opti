import express from 'express';
import path from 'path';
import { fileURLToPath } from 'url';
import dotenv from 'dotenv';
import { GoogleGenAI, ThinkingLevel } from '@google/genai';

dotenv.config();

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const app = express();
const PORT = 3000;

app.use(express.json({ limit: '10mb' }));

// Initialize Gemini Client
const ai = new GoogleGenAI({
  apiKey: process.env.GEMINI_API_KEY || '',
  httpOptions: {
    headers: {
      'User-Agent': 'aistudio-build',
    },
  },
});

// Health check endpoint
app.get('/api/health', (_req, res) => {
  res.json({
    status: 'ok',
    system: 'TunedPC Optimizer Pro Engine',
    timestamp: new Date().toISOString(),
  });
});

// AI System Diagnostics endpoint
app.post('/api/ai/diagnose', async (req, res) => {
  try {
    const { vitals, activeApps, diskStats, currentPreset } = req.body;

    const prompt = `You are the lead Windows 11 PC Optimization Systems Engineer and Kernel Analyst for TunedPC Optimizer Pro.
Analyze the following real-time PC vitals and background footprint:
- CPU Load: ${vitals?.cpu || 45}%
- RAM Usage: ${vitals?.ram || 68}% (${vitals?.ramUsedGb || 10.8}GB / ${vitals?.ramTotalGb || 16}GB)
- GPU Load: ${vitals?.gpu || 30}%, Temp: ${vitals?.gpuTemp || 62}°C
- Disk I/O: ${vitals?.diskIo || 18}MB/s, Free Space: ${diskStats?.freeGb || 42}GB / ${diskStats?.totalGb || 512}GB
- High Startup Impact Apps: ${activeApps?.join(', ') || 'OneDrive, Discord, Steam, Spotify, Epic Games'}
- Current Optimization Mode: ${currentPreset || 'Standard Balanced'}

Task:
Provide a concise, expert diagnostic summary in JSON format with:
1. "healthScore": number from 0 to 100
2. "statusTag": string (e.g. "OPTIMAL", "MODERATE_BOTTLENECK", "CRITICAL_BLOAT", "HIGH_THERMAL")
3. "summary": short 2-3 sentence technical diagnostic
4. "topRecommendations": array of 3 actionable, safe maintenance steps
5. "discardedWarning": explanation of 1 popular "snake-oil" optimization the user should AVOID for this spec (e.g. avoiding RAM flush tools or pagefile disabling).

Ensure valid JSON output without markdown code block backticks if possible, or raw text.`;

    const response = await ai.models.generateContent({
      model: 'gemini-3.6-flash',
      contents: prompt,
      config: {
        responseMimeType: 'application/json',
      },
    });

    const text = response.text || '{}';
    const parsed = JSON.parse(text);
    return res.json({ success: true, data: parsed });
  } catch (error: any) {
    console.error('AI Diagnosis Error:', error);
    return res.status(500).json({
      success: false,
      error: error.message || 'Failed to generate AI diagnosis',
      fallback: {
        healthScore: 78,
        statusTag: 'MODERATE_BOTTLENECK',
        summary:
          'System is operating safely. High memory allocation from 5 startup items and temporary Windows update cache were detected.',
        topRecommendations: [
          'Run 1-Click Clean to clear 4.2GB of temporary delivery optimization logs',
          'Disable non-essential startup services (Spotify, Steam client WebHelper)',
          'Verify NVMe SSD TRIM status and Storage Sense automated schedule',
        ],
        discardedWarning:
          'Do NOT use aggressive RAM Cleaner tools or empty working sets; Windows 11 memory manager handles standby cache efficiently.',
      },
    });
  }
});

// AI Driver Compatibility Check
app.post('/api/ai/driver-check', async (req, res) => {
  try {
    const { deviceType, vendor, currentDriver, hardwareName } = req.body;

    const prompt = `You are an automated Windows 11 Driver Integrity & WHQL Specialist.
Evaluate this hardware component:
- Component: ${deviceType} (${hardwareName})
- Vendor: ${vendor}
- Installed Driver Version: ${currentDriver}

Task:
Return a JSON response with:
1. "isUpToDate": boolean
2. "latestVersion": string (realistic latest version for late 2025 / 2026)
3. "releaseDate": string (e.g. "2026-07-15")
4. "severity": "OPTIMAL" | "RECOMMENDED" | "CRITICAL"
5. "stabilityNotes": concise technical reason to update or stay (e.g., fix for DX12 micro-stuttering, security patch for Wi-Fi 6E, audio buffer latency fix)
6. "whqlVerified": true
7. "safeDownloadSource": official manufacturer URL string`;

    const response = await ai.models.generateContent({
      model: 'gemini-3.6-flash',
      contents: prompt,
      config: {
        responseMimeType: 'application/json',
      },
    });

    const text = response.text || '{}';
    const parsed = JSON.parse(text);
    return res.json({ success: true, data: parsed });
  } catch (error: any) {
    return res.status(500).json({
      success: false,
      error: error.message,
      fallback: {
        isUpToDate: false,
        latestVersion: '556.12 WHQL',
        releaseDate: '2026-07-28',
        severity: 'RECOMMENDED',
        stabilityNotes:
          'Fixes shader compilation stuttering in DirectX 12 games and improves Hardware Accelerated GPU Scheduling efficiency.',
        whqlVerified: true,
        safeDownloadSource: 'https://www.nvidia.com/drivers',
      },
    });
  }
});

// AI Custom Tweak Safety & Risk Assessor
app.post('/api/ai/evaluate-tweak', async (req, res) => {
  try {
    const { tweakName, tweakCommand, category } = req.body;

    const prompt = `You are a Windows Kernel and Registry Security Inspector.
Analyze this user-proposed PC optimization tweak:
- Tweak Name: ${tweakName}
- Tweak Command / Description: ${tweakCommand}
- Category: ${category || 'System'}

Evaluate for Windows 11 stability, safety, and validity.
Return JSON with:
1. "riskCategory": "SAFE" | "MEDIUM_RISK" | "RISKY_DISCARD" | "SNAKE_OIL"
2. "safetyScore": number 0-100
3. "technicalImpact": detailed explanation of kernel or OS behavior under this change
4. "isRecommended": boolean
5. "potentialBreakage": list of Windows features or games that might break if applied (e.g. Windows Update, Game Pass, VR headsets)
6. "safeAlternative": recommended safe alternative if risky`;

    const response = await ai.models.generateContent({
      model: 'gemini-3.6-flash',
      contents: prompt,
      config: {
        responseMimeType: 'application/json',
      },
    });

    const text = response.text || '{}';
    const parsed = JSON.parse(text);
    return res.json({ success: true, data: parsed });
  } catch (error: any) {
    return res.status(500).json({
      success: false,
      error: error.message,
    });
  }
});

// AI Game Optimization & Detection endpoint with High Thinking Mode
app.post('/api/ai/game-optimize', async (req, res) => {
  try {
    const { gameTitle, genre, gpuModel, cpuModel, ramGb } = req.body;

    const prompt = `You are a high-performance Windows 11 Game Engine & GPU Optimization Specialist.
Target Game: "${gameTitle || 'Custom Game'}"
Genre: "${genre || 'Action'}"
System Hardware Context:
- GPU: ${gpuModel || 'NVIDIA GeForce RTX 4070 / 5070'}
- CPU: ${cpuModel || 'AMD Ryzen 7 7800X3D / Intel Core i7 14700K'}
- System Memory: ${ramGb || 32} GB DDR5

Task:
Perform deep reasoning to generate custom high-performance profile settings for this title.
Return JSON with:
1. "title": string
2. "genre": string
3. "gpuPriority": "Realtime" | "High" | "Normal"
4. "gpuSchedulingEnabled": boolean (HAGS recommendation)
5. "networkPriorityEnabled": boolean (DSCP QoS recommendation)
6. "networkQosTag": string (e.g., "DSCP 46 Expedited Forwarding")
7. "hagsRecommended": boolean
8. "shaderCacheMb": number (e.g. 8192 or 10240)
9. "workerThreads": number (optimal CPU worker threads for game engine)
10. "lowLatencyMode": "Reflex Boost" | "Anti-Lag+" | "Standard"
11. "fpsGainPct": estimated percentage FPS gain (number like 15.5)
12. "stutterReductionPct": estimated percentage stutter reduction (number like 35)
13. "description": 2-sentence technical rationale
14. "customPowerShell": single-line PowerShell script to enforce the tweaks
15. "detectedPath": suggested default Windows install directory path`;

    const response = await ai.models.generateContent({
      model: 'gemini-3.1-pro-preview',
      contents: prompt,
      config: {
        thinkingConfig: {
          thinkingLevel: ThinkingLevel.HIGH,
        },
        responseMimeType: 'application/json',
      },
    });

    const text = response.text || '{}';
    const parsed = JSON.parse(text);
    return res.json({ success: true, data: parsed });
  } catch (error: any) {
    console.error('AI Game Optimize Error:', error);
    return res.status(500).json({
      success: false,
      error: error.message,
      fallback: {
        title: req.body.gameTitle || 'Custom High-Performance Game',
        genre: req.body.genre || 'Action / Shooter',
        gpuPriority: 'Realtime',
        gpuSchedulingEnabled: true,
        networkPriorityEnabled: true,
        networkQosTag: 'DSCP 46 (Expedited Forwarding)',
        hagsRecommended: true,
        shaderCacheMb: 8192,
        workerThreads: 8,
        lowLatencyMode: 'Reflex Boost',
        fpsGainPct: 16.5,
        stutterReductionPct: 38,
        description:
          'Enforces High-Priority GPU scheduling, pre-allocates 8GB DX12 shader cache, and optimizes CPU worker thread count to eliminate VRAM stuttering.',
        customPowerShell:
          'Set-ItemProperty -Path "HKLM:\\SOFTWARE\\Microsoft\\DirectX" -Name "MaxShaderCacheSize" -Value 8192',
        detectedPath: `C:\\Program Files (x86)\\Steam\\steamapps\\common\\${req.body.gameTitle || 'Game'}\\game.exe`,
      },
    });
  }
});

// Cloud Settings & Multi-Device Sync Endpoints
let cloudStore: Record<string, any> = {
  activeProfile: {
    userId: 'usr_pro_8841',
    deviceName: 'Desktop-Gaming-Win11',
    theme: 'dark',
    language: 'en',
    autoMaintenanceSchedule: 'weekly',
    presetName: 'Gaming Turbo + Safe Clean',
    cloudBackupDate: new Date().toISOString(),
  },
};

app.get('/api/cloud/settings', (_req, res) => {
  res.json({ success: true, settings: cloudStore.activeProfile });
});

app.post('/api/cloud/settings', (req, res) => {
  const { newSettings } = req.body;
  cloudStore.activeProfile = {
    ...cloudStore.activeProfile,
    ...newSettings,
    cloudBackupDate: new Date().toISOString(),
  };
  res.json({ success: true, settings: cloudStore.activeProfile });
});

// Cloud Health Reports & Background Logs Endpoint
let cloudLogsStore: Array<any> = [
  {
    id: 'log-101',
    timestamp: new Date(Date.now() - 86400000 * 2).toISOString(),
    type: 'SCHEDULED_MAINTENANCE',
    spaceReclaimedMb: 3840,
    itemsOptimized: 14,
    healthBefore: 72,
    healthAfter: 94,
    status: 'SUCCESS',
  },
  {
    id: 'log-102',
    timestamp: new Date(Date.now() - 86400000).toISOString(),
    type: 'REALTIME_ALERT_RESOLVED',
    spaceReclaimedMb: 120,
    itemsOptimized: 2,
    healthBefore: 88,
    healthAfter: 96,
    status: 'SUCCESS',
  },
];

app.get('/api/cloud/reports', (_req, res) => {
  res.json({ success: true, logs: cloudLogsStore });
});

app.post('/api/cloud/reports', (req, res) => {
  const { newLog } = req.body;
  const logEntry = {
    id: `log-${Date.now()}`,
    timestamp: new Date().toISOString(),
    ...newLog,
  };
  cloudLogsStore.unshift(logEntry);
  res.json({ success: true, log: logEntry });
});

// Vite / Static file handling
async function startServer() {
  if (process.env.NODE_ENV !== 'production') {
    const { createServer: createViteServer } = await import('vite');
    const vite = await createViteServer({
      server: { middlewareMode: true },
      appType: 'spa',
    });
    app.use(vite.middlewares);
  } else {
    const distPath = path.join(process.cwd(), 'dist');
    app.use(express.static(distPath));
    app.get('*', (_req, res) => {
      res.sendFile(path.join(distPath, 'index.html'));
    });
  }

  app.listen(PORT, '0.0.0.0', () => {
    console.log(`[TunedPC Optimizer Pro Server] running on http://0.0.0.0:${PORT}`);
  });
}

startServer();
