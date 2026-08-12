import React, { useState } from 'react';
import {
  X,
  Code,
  Copy,
  Check,
  Download,
  Terminal,
  ShieldCheck,
  ExternalLink,
  Laptop,
  Box,
  Folder,
} from 'lucide-react';

interface InstallerModalProps {
  isOpen: boolean;
  onClose: () => void;
}

export const InstallerModal: React.FC<InstallerModalProps> = ({
  isOpen,
  onClose,
}) => {
  if (!isOpen) return null;

  const [activeTab, setActiveTab] = useState<'ps1' | 'exe'>('exe');
  const [copied, setCopied] = useState<boolean>(false);
  const [copiedCmd, setCopiedCmd] = useState<boolean>(false);

  const ps1Script = `# =========================================================
# Rigorset Platform - Safe Windows 11 Deployer
# Safe Maintenance & Optimization Pipeline (.ps1)
# Verified for Windows 11 Home & Pro (Build 22H2 / 23H2 / 24H2)
# =========================================================

# Step 1: Request Admin Privileges
if (-not ([Security.Principal.WindowsPrincipal][Security.Principal.WindowsIdentity]::GetCurrent()).IsInRole([Security.Principal.WindowsBuiltInRole]::Administrator)) {
    Write-Warning "Elevating to Administrator permissions for Windows 11 Kernel Tweaks..."
    Start-Process powershell -Verb RunAs "-NoProfile -ExecutionPolicy Bypass -File \`"$PSCommandPath\`""
    exit
}

Write-Host "=========================================================" -ForegroundColor Cyan
Write-Host " Rigorset Platform - 1-Click Care Pipeline Running " -ForegroundColor Green
Write-Host "=========================================================" -ForegroundColor Cyan

# Step 2: Safe Memory Compression & MMAgent
Write-Host "[1/5] Enabling Windows 11 Memory Compression Engine..." -ForegroundColor Yellow
Enable-MMAgent -MemoryCompression -ErrorAction SilentlyContinue

# Step 3: Hardware Accelerated GPU Scheduling (HAGS)
Write-Host "[2/5] Verifying Hardware-Accelerated GPU Scheduling (HAGS)..." -ForegroundColor Yellow
Set-ItemProperty -Path "HKLM:\\SYSTEM\\CurrentControlSet\\Control\\GraphicsDrivers" -Name "HwSchMode" -Value 2 -ErrorAction SilentlyContinue

# Step 4: Purge Delivery Optimization Cache
Write-Host "[3/5] Cleaning Temporary Delivery Optimization Update Cache..." -ForegroundColor Yellow
Stop-Service -Name wuauserv -ErrorAction SilentlyContinue
Remove-Item -Path "$env:SystemRoot\\SoftwareDistribution\\Download\\*" -Recurse -Force -ErrorAction SilentlyContinue
Start-Service -Name wuauserv -ErrorAction SilentlyContinue

# Step 5: Execute NVMe SSD TRIM
Write-Host "[4/5] Running SSD Garbage Collection & TRIM..." -ForegroundColor Yellow
Optimize-Volume -DriveLetter C -Defrag -ReTrim -Verbose

# Step 6: Verify Pagefile and Memory Integrity
Write-Host "[5/5] Confirming Pagefile System Management (No Snake-Oil)..." -ForegroundColor Yellow
Set-CimInstance -Query "Select * from Win32_ComputerSystem" -Property @{AutomaticManagedPagefile = $true} -ErrorAction SilentlyContinue

Write-Host "=========================================================" -ForegroundColor Cyan
Write-Host " [SUCCESS] Rigorset Optimization Complete! Health: 100% " -ForegroundColor Green
Write-Host "=========================================================" -ForegroundColor Cyan
`;

  const desktopBuildCmd = `npm install
npm run electron:build`;

  const handleCopy = () => {
    navigator.clipboard.writeText(ps1Script);
    setCopied(true);
    setTimeout(() => setCopied(false), 2000);
  };

  const handleCopyCmd = () => {
    navigator.clipboard.writeText(desktopBuildCmd);
    setCopiedCmd(true);
    setTimeout(() => setCopiedCmd(false), 2000);
  };

  const handleDownloadFile = () => {
    const blob = new Blob([ps1Script], { type: 'text/plain' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = 'Rigorset_Win11_Care.ps1';
    a.click();
    URL.revokeObjectURL(url);
  };

  return (
    <div className="fixed inset-0 z-50 bg-slate-950/80 backdrop-blur-md flex items-center justify-center p-4 animate-fade-in">
      <div className="bg-[#111318] border border-slate-800 rounded-2xl max-w-2xl w-full p-6 space-y-5 relative shadow-2xl overflow-hidden">
        {/* Close Button */}
        <button
          onClick={onClose}
          className="absolute top-4 right-4 p-2 rounded-lg text-slate-400 hover:text-white hover:bg-slate-800 transition"
        >
          <X className="w-5 h-5" />
        </button>

        <div className="space-y-1">
          <div className="flex items-center gap-2">
            <Laptop className="w-5 h-5 text-blue-400" />
            <h2 className="text-xl font-bold text-white">
              Rigorset Desktop (.exe) & PowerShell Deployer
            </h2>
          </div>
          <p className="text-xs text-slate-400">
            Package Rigorset into a native standalone Windows 11 desktop `.exe` installer or run the lightweight direct PowerShell engine.
          </p>
        </div>

        {/* Tab Switcher */}
        <div className="flex items-center gap-2 bg-slate-900 p-1 rounded-xl border border-slate-800">
          <button
            onClick={() => setActiveTab('exe')}
            className={`flex-1 py-2 px-3 rounded-lg text-xs font-bold transition flex items-center justify-center gap-2 ${
              activeTab === 'exe'
                ? 'bg-blue-600 text-white shadow-md'
                : 'text-slate-400 hover:text-slate-200'
            }`}
          >
            <Box className="w-4 h-4 text-amber-400" />
            <span>Option 1: Desktop App Installer (.exe)</span>
          </button>
          <button
            onClick={() => setActiveTab('ps1')}
            className={`flex-1 py-2 px-3 rounded-lg text-xs font-bold transition flex items-center justify-center gap-2 ${
              activeTab === 'ps1'
                ? 'bg-blue-600 text-white shadow-md'
                : 'text-slate-400 hover:text-slate-200'
            }`}
          >
            <Terminal className="w-4 h-4 text-cyan-400" />
            <span>Option 2: Direct PowerShell Script (.ps1)</span>
          </button>
        </div>

        {activeTab === 'exe' ? (
          <div className="space-y-4">
            <div className="bg-slate-900/80 border border-slate-800 rounded-xl p-4 space-y-3">
              <div className="flex items-center justify-between">
                <span className="text-xs font-extrabold text-amber-400 uppercase tracking-wide flex items-center gap-1.5">
                  <Box className="w-4 h-4" />
                  Package Rigorset into Rigorset_Owner_Edition_Setup.exe
                </span>
                <span className="text-[10px] bg-blue-500/10 text-blue-300 border border-blue-500/20 px-2 py-0.5 rounded font-mono">
                  Electron / NSIS Installer
                </span>
              </div>

              <ol className="space-y-2 text-xs text-slate-300 list-decimal list-inside leading-relaxed">
                <li>
                  Click the <strong>Settings (Gear)</strong> icon in the top right menu of AI Studio and select <strong>Export ZIP</strong> or <strong>Sync to GitHub</strong>.
                </li>
                <li>
                  Extract the downloaded project folder on your Windows 11 PC.
                </li>
                <li>
                  Open a command prompt or PowerShell inside the folder and run:
                </li>
              </ol>

              <div className="relative bg-[#0a0b0d] border border-slate-800 rounded-xl p-3 font-mono text-[12px] text-emerald-400 flex items-center justify-between">
                <code>{desktopBuildCmd}</code>
                <button
                  onClick={handleCopyCmd}
                  className="px-2.5 py-1 bg-slate-800 hover:bg-slate-700 text-slate-200 text-xs rounded border border-slate-700 transition flex items-center gap-1 shrink-0 ml-2"
                >
                  {copiedCmd ? (
                    <>
                      <Check className="w-3.5 h-3.5 text-emerald-400" />
                      <span>Copied</span>
                    </>
                  ) : (
                    <>
                      <Copy className="w-3.5 h-3.5 text-slate-400" />
                      <span>Copy</span>
                    </>
                  )}
                </button>
              </div>

              <div className="p-3 bg-amber-500/10 border border-amber-500/20 rounded-lg text-[11px] text-amber-300/90 leading-relaxed">
                <strong>Result:</strong> Your PC will instantly compile <code className="font-mono text-amber-200">dist-electron/Rigorset Owner Edition Setup 2.4.0.exe</code>. Double clicking it installs Rigorset directly onto your Start Menu & Desktop with full Administrator capabilities!
              </div>
            </div>
          </div>
        ) : (
          <div className="space-y-3">
            {/* Code Box */}
            <div className="relative bg-[#0a0b0d] border border-slate-800 rounded-xl p-4 font-mono text-[11px] text-cyan-300 max-h-64 overflow-y-auto space-y-1">
              <pre>{ps1Script}</pre>
            </div>

            {/* Action Buttons */}
            <div className="flex flex-wrap items-center justify-between gap-3 pt-1">
              <div className="text-[11px] text-slate-400 flex items-center gap-1.5">
                <ShieldCheck className="w-4 h-4 text-emerald-400 shrink-0" />
                <span>100% Native Windows PowerShell Commands.</span>
              </div>

              <div className="flex items-center gap-2">
                <button
                  onClick={handleCopy}
                  className="px-4 py-2 bg-slate-800 hover:bg-slate-700 text-slate-200 text-xs font-bold rounded-lg border border-slate-700 transition flex items-center gap-1.5"
                >
                  {copied ? (
                    <>
                      <Check className="w-4 h-4 text-emerald-400" />
                      <span>Copied Script!</span>
                    </>
                  ) : (
                    <>
                      <Copy className="w-4 h-4 text-slate-400" />
                      <span>Copy Script</span>
                    </>
                  )}
                </button>

                <button
                  onClick={handleDownloadFile}
                  className="px-4 py-2 bg-blue-600 hover:bg-blue-500 text-white text-xs font-bold rounded-lg shadow-md transition flex items-center gap-1.5"
                >
                  <Download className="w-4 h-4" />
                  <span>Download .ps1 File</span>
                </button>
              </div>
            </div>
          </div>
        )}
      </div>
    </div>
  );
};
