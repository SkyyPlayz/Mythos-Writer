/**
 * PLAN-COACHING-OPT-IN — renderer `AppSettings.coaching` type.
 *
 * Owns: the ambient merge that adds `coaching` to the global `AppSettings`
 * interface (declared in global.d.ts) for the renderer.
 * Never touches: IPC, preload, or coach prompts — prompt surfaces read the
 * value only through partner/partnerPersonality `effectiveCoachingMode`.
 */
declare global {
  interface AppSettings {
    /**
     * Coaching opt-in. Missing → off with a dormant Teacher mode (main
     * normalizes on load). `mode` applies only while `optIn` is true, and
     * stays stored while off so the next enable restores it.
     */
    coaching?: { optIn: boolean; mode: 'assistant' | 'teacher' };
  }
}

export {};
