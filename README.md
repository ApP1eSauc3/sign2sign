# Sign2Sign

**Admin-to-driver project tracker with intelligent routing, automated data synchronization, and cross-platform desktop support.**

## Overview

Sign2Sign is a comprehensive logistics and project tracking application designed to streamline communication and coordination between administrators and drivers. The platform features real-time map routing, automated Google Sheets integration, and a native Electron desktop client for administrative operations.

### Key Features

- 🗺️ **Map-Based Routing** - Interactive route visualization and navigation for drivers
- 📊 **Google Sheets Integration** - Automated reading and synchronization of project data
- 🖥️ **Electron Desktop Admin Portal** - Native desktop application for administrative management
- 📱 **Cross-Platform Mobile** - iOS, Android, and Web support via Expo
- 🔄 **Real-Time Updates** - Live project and driver status synchronization
- 📍 **Location Tracking** - Route optimization and driver location monitoring

## Tech Stack

### Frontend
- **React Native** (v0.83.2) - Cross-platform mobile framework
- **React** (v19.2.0) - UI component library
- **Expo** (v55.0.7) - Universal React framework for iOS, Android, and Web
- **TypeScript** (v5.9.2) - Type-safe development

### Desktop
- **Electron** - Native desktop application for admin portal

### Backend Integration
- **Google Sheets API** - Automated data synchronization

## Getting Started

### Prerequisites

- Node.js 16+ and npm/yarn
- Expo CLI (`npm install -g expo-cli`)
- For iOS: Xcode (macOS only)
- For Android: Android Studio and SDK
- For Electron: Native build tools for your OS

### Installation

```bash
# Clone the repository
git clone https://github.com/ApP1eSauc3/sign2sign.git
cd sign2sign

# Install dependencies
npm install
