/**
 * PLAN-COACHING-OPT-IN — main-process `AppSettings.coaching` type.
 *
 * Owns: the module augmentation that adds `coaching` to `AppSettings`, so
 * appSettingsLoad can default + normalize it without touching ipc.ts.
 * Never touches: ipc.ts, settings I/O, or any runtime value — types only.
 */
import './ipc.js';

declare module './ipc.js' {
  interface AppSettings {
    /**
     * Coaching opt-in. Off by default: the Writing Coach answers as a quiet
     * assistant. `mode` stays stored while off so the next enable restores it.
     */
    coaching?: { optIn: boolean; mode: 'assistant' | 'teacher' };
  }
}

export {};
