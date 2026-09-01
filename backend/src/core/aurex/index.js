/**
 * Aurex Core Layer — public facade
 * Routes should import from here, not directly from aurex external API.
 * This layer orchestrates host-mode execution, server-context, tools, and infrastructure prompts.
 * It delegates heavy coding runs to the external Aurex worker when needed, but serves
 * infrastructure intelligence natively via lib/exec and lib/config.
 *
 * Layering: routes -> core/aurex -> lib/*
 */
export { buildServerContext } from './engine.js';
export { PANEL_TOOLS, getCapabilities } from './tools/index.js';
export { INFRASTRUCTURE_CONTRACT, getInfrastructurePrompt } from './prompts/index.js';
export { ensureHostWorkspace, resolveHostPath } from './engine.js';
