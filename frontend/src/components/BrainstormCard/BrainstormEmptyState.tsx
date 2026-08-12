import { EmptyState } from '../ui/EmptyState';
import './BrainstormEmptyState.css';

interface Cta {
  label: string;
  prompt: string;
}

const CTAS: Cta[] = [
  {
    label: 'Describe a character',
    prompt: "Let's brainstorm a new character. Tell me their role in the story, what they want, and what stands in their way.",
  },
  {
    label: 'Explore a setting',
    prompt: "Let's develop a setting for my story. Describe the world, its atmosphere, and how it shapes the characters who live there.",
  },
  {
    label: 'Unstick a plot point',
    prompt: "I'm stuck on a plot problem. Let me describe the situation and you help me think through possible directions.",
  },
];

interface Props {
  onSeedPrompt: (text: string) => void;
}

export function BrainstormEmptyState({ onSeedPrompt }: Props) {
  return (
    <EmptyState
      className="bs-empty-state"
      ariaLabel="Brainstorm empty state"
      title={(
        <h2 className="bs-empty-heading">
          No facts yet — mention character names or locations to build your vault.
        </h2>
      )}
      hint={(
        <p className="bs-empty-sub">
          Ideas you brainstorm here are saved to your <strong>Notes Vault</strong>, not your Story Vault.
        </p>
      )}
      actions={(
        <ul className="bs-empty-ctas" aria-label="Quick-start prompts">
          {CTAS.map((cta) => (
            <li key={cta.label}>
              <button
                className="bs-empty-cta-btn"
                type="button"
                aria-label={cta.label}
                onClick={() => onSeedPrompt(cta.prompt)}
              >
                {cta.label}
              </button>
            </li>
          ))}
        </ul>
      )}
    />
  );
}
