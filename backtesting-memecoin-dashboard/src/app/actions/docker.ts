"use server";

import Docker from "dockerode";
import { createClient } from 'redis';

// Connect to the local Docker socket
const docker = new Docker({ socketPath: "/var/run/docker.sock" });

const SERVICES = ["ghost_scout", "ghost_sniper", "ghost_evaluator"];

export type ContainerStatus = {
  id: string;
  name: string;
  state: string;
  status: string;
};

export async function getFleetStatus(): Promise<ContainerStatus[]> {
  try {
    const containers = await docker.listContainers({ all: true });
    return containers
      .filter((c) => SERVICES.includes(c.Names[0].replace("/", "")))
      .map((c) => ({
        id: c.Id,
        name: c.Names[0].replace("/", ""),
        state: c.State,
        status: c.Status,
      }));
  } catch (error) {
    console.error("Docker Socket Error:", error);
    return [];
  }
}

export async function toggleContainer(name: string, action: "start" | "stop" | "restart") {
  try {
    const container = docker.getContainer(name);
    if (action === "start") await container.start();
    if (action === "stop") await container.stop();
    if (action === "restart") await container.restart();
    return { success: true };
  } catch (error: any) {
    return { success: false, error: error.message };
  }
}

// THE MISSING EXPORT
export async function toggleFleet(action: "start" | "stop") {
  try {
    const promises = SERVICES.map(name => {
      const container = docker.getContainer(name);
      return action === 'start' ? container.start() : container.stop();
    });

    // We use allSettled so one crash doesn't kill the whole command
    await Promise.allSettled(promises);
    return { success: true };
  } catch (error: any) {
    return { success: false, error: error.message };
  }
}

export async function getContainerLogs(name: string) {
  try {
    const container = docker.getContainer(name);
    const logsBuffer = await container.logs({
      stdout: true,
      stderr: true,
      tail: 50,
      timestamps: false
    });

    const logString = logsBuffer.toString('utf-8');
    return logString.replace(/[^\x20-\x7E\n]/g, '');
  } catch (error) {
    return "OFFLINE // NO_LOG_STREAM";
  }
}

export async function wipeRedisCache() {
  try {
    // Connect to the local port 6379 since dashboard is outside Docker
    const client = createClient({ url: 'redis://localhost:6379' });
    await client.connect();
    await client.flushAll();
    await client.disconnect();
    return { success: true };
  } catch (error: any) {
    console.error("Redis Flush Error:", error);
    return { success: false, error: error.message };
  }
}

// --- GLOBAL KILL SWITCH ---
// Uses docker compose down to physically destroy containers, networks, and free resources.
// This is more aggressive than toggleFleet('stop') which only pauses containers.
export async function killGhostProtocol(): Promise<{ success: boolean; error?: string }> {
  const { exec } = require("child_process");
  const path = require("path");

  // Resolve the ghost_protocol directory relative to the project root
  const projectRoot = path.resolve(process.cwd(), "..");
  const composePath = path.join(projectRoot, "ghost_protocol");

  return new Promise((resolve) => {
    exec(
      `docker compose -f ${composePath}/docker-compose.yml down --remove-orphans`,
      { timeout: 30000 },
      (error: any, stdout: string, stderr: string) => {
        if (error) {
          console.error("[KILL SWITCH] Error:", stderr || error.message);
          resolve({ success: false, error: stderr || error.message });
        } else {
          console.log("[KILL SWITCH] Ghost Protocol terminated:", stdout);
          resolve({ success: true });
        }
      }
    );
  });
}

// ==========================================
// MILESTONE PROTOCOL ACTIONS
// ==========================================

const MILESTONE_SERVICES = ["milestone_scout", "milestone_sniper", "milestone_evaluator"];

export async function getMilestoneFleetStatus(): Promise<ContainerStatus[]> {
  try {
    const containers = await docker.listContainers({ all: true });
    return containers
      .filter((c) => MILESTONE_SERVICES.includes(c.Names[0].replace("/", "")))
      .map((c) => ({
        id: c.Id,
        name: c.Names[0].replace("/", ""),
        state: c.State,
        status: c.Status,
      }));
  } catch (error) {
    console.error("Docker Socket Error (Milestone):", error);
    return [];
  }
}

export async function toggleMilestoneContainer(name: string, action: "start" | "stop" | "restart") {
  try {
    const container = docker.getContainer(name);
    if (action === "start") await container.start();
    if (action === "stop") await container.stop();
    if (action === "restart") await container.restart();
    return { success: true };
  } catch (error: any) {
    return { success: false, error: error.message };
  }
}

export async function toggleMilestoneFleet(action: "start" | "stop") {
  try {
    const promises = MILESTONE_SERVICES.map(name => {
      const container = docker.getContainer(name);
      return action === 'start' ? container.start() : container.stop();
    });
    await Promise.allSettled(promises);
    return { success: true };
  } catch (error: any) {
    return { success: false, error: error.message };
  }
}

export async function getMilestoneContainerLogs(name: string) {
  try {
    const container = docker.getContainer(name);
    const logsBuffer = await container.logs({
      stdout: true,
      stderr: true,
      tail: 50,
      timestamps: false
    });
    const logString = logsBuffer.toString('utf-8');
    return logString.replace(/[^\x20-\x7E\n]/g, '');
  } catch (error) {
    return "OFFLINE // NO_LOG_STREAM";
  }
}

export async function killMilestoneProtocol(): Promise<{ success: boolean; error?: string }> {
  const { exec } = require("child_process");
  const path = require("path");

  const projectRoot = path.resolve(process.cwd(), "..");
  const composePath = path.join(projectRoot, "milestone_protocol");

  return new Promise((resolve) => {
    exec(
      `docker compose -f ${composePath}/docker-compose.yml down --remove-orphans`,
      { timeout: 30000 },
      (error: any, stdout: string, stderr: string) => {
        if (error) {
          console.error("[MILESTONE KILL] Error:", stderr || error.message);
          resolve({ success: false, error: stderr || error.message });
        } else {
          console.log("[MILESTONE KILL] Milestone Protocol terminated:", stdout);
          resolve({ success: true });
        }
      }
    );
  });
}
