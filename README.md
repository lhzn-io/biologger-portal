# Biologger Portal Dashboard (biologger-portal)

Vite and React portal dashboard for registering, managing, validating, and visualizing marine animal tracking biologger datasets.

## Overview

This project provides a management and monitoring portal designed to interface with the [Biologger Simulation Environment (biologger-sim)](https://github.com/lhzn-io/biologger-sim). It serves as the primary dashboard for:

1.  **Dataset Ingestion & Registry:** Coordination and ingestion of marine predator telemetry logs.
2.  **Diagnostics & Schema Validation:** Executing light schema checks and deep sensor integrity audits before streaming data to the visualization client.
3.  **Simulation Orchestration:** Monitoring real-time ZeroMQ simulation streams driven by `biologger-sim` and managing Pixar USD 3D kinematics visualization states in NVIDIA Omniverse.
4.  **Embedded AI Expert Chat:** Interacting with an on-host VLM (Vision-Language Model) specialist chatbot powered by the [Uplift Agent Lab (lhzn-io/uplift-agent-lab)](https://github.com/lhzn-io/uplift-agent-lab).

---

## Directory Structure

This repository uses a structured root layout:
*   **Root Directory:** Contains only environment configuration and definition files (such as `package.json`, `tsconfig.json`, `tailwind.config.js`, and `Dockerfile`).
*   **`app/` Folder:** Encapsulates the entire React and Vite web application, including HTML templates, custom styles, and core source code components.

```
.
├── Dockerfile
├── LICENSE
├── README.md
├── AGENTS.md
├── package.json
├── package-lock.json
├── postcss.config.js
├── tailwind.config.js
├── tsconfig.json
├── tsconfig.node.json
└── app
    ├── index.html
    ├── tsconfig.app.json
    ├── vite.config.ts
    └── src
        ├── App.tsx
        ├── main.tsx
        ├── index.css
        └── components
            ├── AIAssistantSidebar.tsx
            ├── AnalyticalViewport.tsx
            ├── DatasetRegistry.tsx
            ├── DiagnosticViewer.tsx
            └── SimOrchestrator.tsx
```

---

## Getting Started

### Prerequisites
*   Node.js (version 20 or higher)
*   npm (version 10 or higher)

### Installation
1.  Clone the repository:
    ```bash
    git clone https://github.com/whoi-mpg/biologger-portal.git
    cd biologger-portal
    ```
2.  Install dependencies:
    ```bash
    npm install
    ```

### Running the Development Server
To launch the Vite development server locally:
```bash
npm run dev
```
The server will boot up and be accessible in the browser (by default on port 5173).

### Compiling for Production
To compile type-safe production bundles:
```bash
npm run build
```
Vite compiles and outputs the production bundle inside `app/dist/`.

### Previewing the Production Build
To test the production build locally:
```bash
npm run preview
```

---

## Deployment Architecture
The portal is designed for platform-agnostic dev deployments, and is initially hosted on a Mac Studio (M4 Max). This hardware hosts the node server and proxies AI requests directly to local open-weights mlx-vlm model servers running on Apple Silicon unified memory.

---

## Docker Deployment
A Dockerfile is provided at the root of the project to package the application.
1.  Build the image:
    ```bash
    docker build -t biologger-portal:latest .
    ```
2.  Run the container:
    ```bash
    docker run -d -p 8080:80 biologger-portal:latest
    ```

---

## Attribution
This repository was contributed by Daniel Fry with the goal of accelerating the research throughput of the Woods Hole Oceanographic Institution Marine Predators Group lab in collaboration with PI Dr. Camrin Braun.

---

## License
This project is licensed under the Apache License, Version 2.0. See the `LICENSE` file for details.
