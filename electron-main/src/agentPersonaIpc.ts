import { ipcMain } from 'electron';
import { isFromTopFrame, UNTRUSTED_FRAME_REJECTION, IPC_CHANNELS } from './ipc.js';
import { wrapIpcHandler } from './ipcErrors.js';
import {
  loadPersonaFile,
  resetPersonaFile,
  type AgentPersonaName,
  type PersonaKey,
} from './agentPersona.js';
import type { AgentPersonaReadPayload, AgentPersonaResetPayload } from './ipc.js';

export function registerAgentPersonaHandlers(getDataPath: () => string): void {
  ipcMain.handle(IPC_CHANNELS.AGENT_PERSONA_READ, wrapIpcHandler(IPC_CHANNELS.AGENT_PERSONA_READ, (event, payload: AgentPersonaReadPayload) => {
    if (!isFromTopFrame(event)) return UNTRUSTED_FRAME_REJECTION;
    const { agentName, key } = payload;
    const file = loadPersonaFile(getDataPath(), agentName as AgentPersonaName, key as PersonaKey);
    return { content: file.content, isCustom: file.isCustom };
  }));

  ipcMain.handle(IPC_CHANNELS.AGENT_PERSONA_RESET, wrapIpcHandler(IPC_CHANNELS.AGENT_PERSONA_RESET, (event, payload: AgentPersonaResetPayload) => {
    if (!isFromTopFrame(event)) return UNTRUSTED_FRAME_REJECTION;
    const { agentName, key } = payload;
    resetPersonaFile(getDataPath(), agentName as AgentPersonaName, key as PersonaKey);
    return { success: true };
  }));
}
