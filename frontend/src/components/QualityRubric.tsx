import { useEffect, useRef } from 'react';
import './QualityRubric.css';

interface Props {
  onClose: () => void;
}

export default function QualityRubric({ onClose }: Props) {
  const dialogRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    dialogRef.current?.focus();
  }, []);

  useEffect(() => {
    const handler = (e: KeyboardEvent) => {
      if (e.key === 'Escape') onClose();
    };
    document.addEventListener('keydown', handler);
    return () => document.removeEventListener('keydown', handler);
  }, [onClose]);

  return (
    <div className="quality-rubric-overlay" role="dialog" aria-modal="true" aria-label="Quality standards for AI generations">
      <div
        ref={dialogRef}
        className="quality-rubric-panel"
        tabIndex={-1}
        onClick={(e) => e.stopPropagation()}
      >
        <div className="quality-rubric-header">
          <h2 className="quality-rubric-title">Quality Standards for AI Generations</h2>
          <button
            className="quality-rubric-close"
            onClick={onClose}
            aria-label="Close quality rubric"
            type="button"
          >
            ✕
          </button>
        </div>

        <div className="quality-rubric-body">
          <p className="quality-rubric-intro">
            Use this guide to evaluate writing suggestions from the Writing Assistant and Brainstorm Agent.
          </p>

          <section className="rubric-criterion">
            <h3 className="rubric-criterion-title">1. Specificity</h3>
            <p className="rubric-criterion-sub">Concrete details grounded in your world</p>
            <p className="rubric-criterion-question">Does the text include unique details, names, sensory anchors, or specific traits?</p>
            <ul className="rubric-stars-list">
              <li><strong>1★ Generic</strong> — Uses vague language or placeholders. &ldquo;The character entered and felt sad.&rdquo;</li>
              <li><strong>2★ Adequate</strong> — Has basic details but could be richer. &ldquo;Maya entered the tavern and saw people.&rdquo;</li>
              <li><strong>3★ Specific</strong> — Rich, unique details. &ldquo;Maya ducked under the tavern&apos;s low oak beams, sticky with ale and candlewax, and caught the smell of leather and wet peat.&rdquo;</li>
            </ul>
          </section>

          <section className="rubric-criterion">
            <h3 className="rubric-criterion-title">2. Coherence</h3>
            <p className="rubric-criterion-sub">Consistency with prior context</p>
            <p className="rubric-criterion-question">Does the text follow logically? Do character voices, world rules, and plot threads stay consistent?</p>
            <ul className="rubric-stars-list">
              <li><strong>1★ Broken</strong> — Contradicts earlier text or violates established rules.</li>
              <li><strong>2★ Plausible</strong> — Follows logic but feels tacked-on.</li>
              <li><strong>3★ Seamless</strong> — Builds naturally, echoes your voice, feels inevitable.</li>
            </ul>
          </section>

          <section className="rubric-criterion">
            <h3 className="rubric-criterion-title">3. Genre Fit</h3>
            <p className="rubric-criterion-sub">Authenticity to your chosen genre</p>
            <p className="rubric-criterion-question">Does the text sound like it belongs in this genre? Does it lean into or shy away from conventions?</p>
            <ul className="rubric-stars-list">
              <li><strong>1★ Mismatched</strong> — Contradicts the genre. A somber epic turning whimsical; a cozy mystery with graphic violence.</li>
              <li><strong>2★ Competent</strong> — Follows genre tropes but feels generic.</li>
              <li><strong>3★ Authentic</strong> — Feels at home in this genre and your voice.</li>
            </ul>
          </section>

          <section className="rubric-criterion">
            <h3 className="rubric-criterion-title">4. Narrative Voice Consistency</h3>
            <p className="rubric-criterion-sub">Steady POV, tone, and prose style</p>
            <p className="rubric-criterion-question">Does the prose maintain the point-of-view, tone, vocabulary level, and sentence rhythm you&apos;ve established?</p>
            <ul className="rubric-stars-list">
              <li><strong>1★ Off</strong> — Sudden shifts in tense, vocabulary, or POV.</li>
              <li><strong>2★ Close</strong> — Generally consistent with minor slip-ups.</li>
              <li><strong>3★ Locked</strong> — Indistinguishable from your surrounding text.</li>
            </ul>
          </section>

          <section className="rubric-criterion">
            <h3 className="rubric-criterion-title">5. Usefulness as Starter</h3>
            <p className="rubric-criterion-sub">Can you build on this draft?</p>
            <p className="rubric-criterion-question">Is the output useful as a foundation for revision, or does it need to be discarded?</p>
            <ul className="rubric-stars-list">
              <li><strong>1★ Starting over</strong> — So off-base you discard it and begin fresh.</li>
              <li><strong>2★ Salvageable</strong> — Usable with significant rewrites.</li>
              <li><strong>3★ Ready to revise</strong> — Strong foundation, clear direction, only minor tweaks needed.</li>
            </ul>
          </section>

          <section className="rubric-how-to-use">
            <h3 className="rubric-criterion-title">How to use this guide</h3>
            <ul className="rubric-stars-list">
              <li>After an AI generation, read through the criteria above.</li>
              <li>Ask: &ldquo;How well does this hit each criterion?&rdquo;</li>
              <li>If most are at 2–3★, the output is usable; refine it with the <strong>Refine</strong> chips if needed.</li>
              <li>If most are at 1★, either discard and try again, or use <strong>Refine</strong> to steer (e.g., +specific).</li>
            </ul>
          </section>
        </div>
      </div>
    </div>
  );
}
