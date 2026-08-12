# Rigorset Owner Edition — Windows 11 PC Optimization Platform

**Rigorset** is an owner-first, evidence-driven Windows 11 performance engineering platform designed for gaming optimization, frame-time consistency, system responsiveness, and low-level diagnostic management.

---

## 🚀 How to Build the Native Standalone Desktop Application (.exe)

Rigorset includes a full **Electron** wrapper so you can compile it directly into an installed Windows 11 `.exe` installer.

### Prerequisites
- [Node.js (v18 or higher)](https://nodejs.org/)
- Windows 11 PC (Build 22H2 / 23H2 / 24H2)

### Steps to Build `Rigorset Owner Edition Setup 2.4.0.exe`

1. **Clone or Download** this repository onto your Windows 11 PC.
2. Open **Command Prompt** or **PowerShell** inside the extracted project folder.
3. Install dependencies:
   ```cmd
   npm install
   ```
4. Build the Electron NSIS Desktop Application:
   ```cmd
   npm run electron:build
   ```
5. Once compilation finishes, navigate to the newly created `dist-electron` folder:
   ```
   dist-electron\Rigorset Owner Edition Setup 2.4.0.exe
   ```
6. Double-click the installer to install Rigorset natively onto your Windows Start Menu & Desktop!

---

## ⚡ Alternative Direct PowerShell Care Engine (.ps1)

If you prefer to run low-level maintenance routines without compiling the desktop application:

1. Open **PowerShell as Administrator**.
2. Run the included safe deployment script:
   ```powershell
   Set-ExecutionPolicy -ExecutionPolicy Unrestricted -Scope Process
   & ".\Rigorset_Win11_Care.ps1"
   ```

---

## 🛡️ Core Capabilities & Principles
- **Evidence-Driven Recommendation Engine**: Evaluates Windows configuration with strict maturity levels and risk scoring.
- **Competitive Gaming Safety Engine**: 100% compliant with Riot Vanguard, EAC, BattlEye, and COD Ricochet. Zero DLL memory injection.
- **Deterministic Rollback**: Comprehensive change journal with single-click restoration of initial system states.
- **Unrestricted Owner Build**: Zero locks, zero paywalls, zero simulated features.
