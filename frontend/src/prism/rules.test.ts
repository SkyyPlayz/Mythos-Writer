// Prism (#1764) — rule engine: one describe per check (hits and misses),
// offsets, U+FFFC handling, thresholds, sort order, stats and a perf smoke.

import { describe, it, expect } from 'vitest';
import { computePrismStats, PRISM_RULES, runPrismRules } from './rules';
import {
  PRISM_CHECK_IDS,
  type PrismCheckId,
  type PrismFinding,
  type PrismParagraph,
  type PrismThresholds,
} from './types';

const TH: PrismThresholds = {
  longSentenceWords: 30,
  overusedMinRepeats: 3,
  overusedWindowWords: 100,
};

function paras(...texts: string[]): PrismParagraph[] {
  return texts.map((text) => ({ text, italic: [] }));
}

function run(
  id: PrismCheckId,
  input: PrismParagraph[] | string,
  th: PrismThresholds = TH
): PrismFinding[] {
  return PRISM_RULES[id](typeof input === 'string' ? paras(input) : input, th);
}

/** The flagged text of each finding, in order. */
function hits(
  id: PrismCheckId,
  input: PrismParagraph[] | string,
  th: PrismThresholds = TH
): string[] {
  const ps = typeof input === 'string' ? paras(input) : input;
  return run(id, ps, th).map((f) => ps[f.paragraph].text.slice(f.from, f.to));
}

describe('overused-words', () => {
  it('flags every occurrence of a word repeated inside the window', () => {
    const text = 'The grim sky hung low. A grim wind rose. His grim face did not change.';
    const found = run('overused-words', text);
    expect(found.map((f) => text.slice(f.from, f.to))).toEqual(['grim', 'grim', 'grim']);
    expect(found[0].message).toBe('‘grim’ used 3 times close together');
  });

  it('counts the whole cluster across paragraphs and folds a possessive', () => {
    const ps = paras(
      'The engine coughed.',
      'The engine’s hum faded.',
      'Then the engine died, and the engine stayed dead.'
    );
    expect(hits('overused-words', ps)).toEqual(['engine', 'engine’s', 'engine', 'engine']);
    expect(run('overused-words', ps)[0].message).toBe('‘engine’ used 4 times close together');
  });

  it('ignores stopwords, short words and repeats spread wider than the window', () => {
    expect(
      hits('overused-words', 'She said that she said that she said that it was fine.')
    ).toEqual([]);
    expect(hits('overused-words', 'The cat sat. The cat ran. The cat hid.')).toEqual([]);
    const filler = Array.from({ length: 60 }, () => 'and so on').join(' ');
    expect(
      hits('overused-words', `A grim start. ${filler} grim middle. ${filler} grim end.`)
    ).toEqual([]);
    // Control: the same three repeats packed close together are flagged.
    expect(hits('overused-words', 'A grim start, a grim middle, a grim end.')).toHaveLength(3);
  });

  it('leaves names alone (capitalised mid-sentence)', () => {
    expect(hits('overused-words', 'Elena ran. Then Elena hid. Nobody found Elena there.')).toEqual(
      []
    );
    expect(
      hits('overused-words', 'The tower fell. Then the tower burned. Nobody saw the tower there.')
    ).toHaveLength(3);
  });

  it('treats a name after a closing straight quote or a plural possessive as a name', () => {
    expect(
      hits('overused-words', '"Go," Marcus said. "Now," Marcus said. "Why?" Marcus asked.')
    ).toEqual([]);
    expect(hits('overused-words', "The twins' Hound bayed. Hound slept. Hound woke.")).toEqual([]);
    // Control: a lowercase word in the same spots is still counted.
    expect(
      hits('overused-words', "The twins' hound bayed. The hound slept. The hound woke.")
    ).toHaveLength(3);
  });

  it('follows the repeat and window thresholds', () => {
    const text = 'A grim sky. A grim wind.';
    expect(hits('overused-words', text)).toEqual([]);
    expect(hits('overused-words', text, { ...TH, overusedMinRepeats: 2 })).toEqual([
      'grim',
      'grim',
    ]);
    expect(
      hits('overused-words', text, { ...TH, overusedMinRepeats: 2, overusedWindowWords: 3 })
    ).toEqual([]);
  });
});

describe('crutch-words', () => {
  it('flags single crutch words whole-word and case-insensitive', () => {
    const found = run('crutch-words', 'Suddenly it was just very quiet. He really knew.');
    expect(hits('crutch-words', 'Suddenly it was just very quiet. He really knew.')).toEqual([
      'Suddenly',
      'just',
      'very',
      'really',
    ]);
    expect(found[1].message).toBe('Crutch word: ‘just’');
  });

  it('flags crutch phrases as one range', () => {
    expect(hits('crutch-words', 'She began to cry. It was a bit cold and kind of sad.')).toEqual([
      'began to',
      'a bit',
      'kind of',
    ]);
  });

  it('does not match inside other words or noun uses', () => {
    expect(hits('crutch-words', 'Justice was adjusted. Every vessel sailed.')).toEqual([]);
    expect(hits('crutch-words', 'What kind of man is he? A sort of priest.')).toEqual([]);
    expect(hits('crutch-words', 'I would rather walk. Fish rather than meat.')).toEqual([]);
    expect(hits('crutch-words', 'It was kind of sad and rather cold.')).toEqual([
      'kind of',
      'rather',
    ]);
  });

  it('treats determiner + adjective + kind/sort of as a noun use', () => {
    expect(hits('crutch-words', 'A strange kind of calm settled. A new sort of fear.')).toEqual([]);
    expect(hits('crutch-words', 'This is kind of weird. That was sort of funny.')).toEqual([
      'kind of',
      'sort of',
    ]);
    // A noun in the slot is still a hedge.
    expect(
      hits(
        'crutch-words',
        'The man kind of smiled. His voice sort of cracked. The guard kind of shrugged.'
      )
    ).toEqual(['kind of', 'sort of', 'kind of']);
    expect(hits('crutch-words', 'A strange kind of calm. The man kind of smiled.')).toEqual([
      'kind of',
    ]);
  });
});

describe('adverbs', () => {
  it('flags -ly adverbs', () => {
    const found = run('adverbs', 'She ran quickly and spoke softly.');
    expect(hits('adverbs', 'She ran quickly and spoke softly.')).toEqual(['quickly', 'softly']);
    expect(found[0].message).toBe('Adverb: ‘quickly’');
  });

  it('flags a sentence-initial adverb', () => {
    expect(hits('adverbs', 'Slowly, the door opened.')).toEqual(['Slowly']);
  });

  it('skips common non-adverbs, names, short words and crutch words', () => {
    expect(
      hits('adverbs', 'The friendly family had an early, lovely and only July picnic in Italy.')
    ).toEqual([]);
    expect(hits('adverbs', 'We met Beverly and Emily. A fly flew by.')).toEqual([]);
    expect(hits('adverbs', 'It was really actually fine.')).toEqual([]);
    expect(hits('adverbs', 'Beverly smiled warmly.')).toEqual(['warmly']);
  });

  it('skips -ly adjectives and names, checking the last part of a hyphenated word', () => {
    expect(
      hits(
        'adverbs',
        'His gravelly voice rose. The spindly legs shook. A deathly silence fell. A cuddly bear sat.'
      )
    ).toEqual([]);
    expect(
      hits('adverbs', 'Scaly skin. A scraggly beard. A pot-belly stove. A straggly, wriggly doily.')
    ).toEqual([]);
    expect(
      hits('adverbs', 'Tilly ran home. Milly and Nelly waved. The underbelly and panoply.')
    ).toEqual([]);
    // Control: a hyphenated adverb is still an adverb.
    expect(hits('adverbs', 'He waved half-heartedly.')).toEqual(['half-heartedly']);
  });

  it('does not treat a straight closing quote as a sentence start', () => {
    expect(hits('adverbs', '"Hi," Brockly said.')).toEqual([]);
    expect(hits('adverbs', '“Hi,” Brockly said.')).toEqual([]);
    // Control: an opening straight quote still starts the speech.
    expect(hits('adverbs', 'She said, "Quickly now."')).toEqual(['Quickly']);
    expect(hits('adverbs', "She said, 'Quickly now.'")).toEqual(['Quickly']);
  });
});

describe('passive-voice', () => {
  it('flags be + irregular participle and be + -ed', () => {
    const found = run('passive-voice', 'The box was taken. The letters were opened at dawn.');
    expect(hits('passive-voice', 'The box was taken. The letters were opened at dawn.')).toEqual([
      'was taken',
      'were opened',
    ]);
    expect(found[0].message).toBe('Passive voice: ‘was taken’');
  });

  it('marks the whole phrase including adverbs and been/being', () => {
    expect(
      hits(
        'passive-voice',
        'The door was quickly not locked. He had been told. It was being watched.'
      )
    ).toEqual(['was quickly not locked', 'been told', 'was being watched']);
    expect(hits('passive-voice', 'He got caught.')).toEqual(['got caught']);
  });

  it('ignores adjectives, active voice and broken phrases', () => {
    expect(
      hits('passive-voice', 'She was tired. He was interested. They were married. I used to.')
    ).toEqual([]);
    expect(hits('passive-voice', 'She was happy. He took the box. The seed was red.')).toEqual([]);
    expect(hits('passive-voice', 'It was, opened later. It was. Opened later.')).toEqual([]);
    expect(hits('passive-voice', 'The garden was golden and the kitten was open.')).toEqual([]);
    expect(hits('passive-voice', 'She was tired. She was carried home.')).toEqual(['was carried']);
  });

  it('ignores names, -ed nouns and the noun "being"', () => {
    expect(
      hits('passive-voice', 'His name was Alfred. This is Ahmed. My name is Mohammed.')
    ).toEqual([]);
    expect(
      hits('passive-voice', 'It was hatred that drove him. There was bloodshed. It is infrared.')
    ).toEqual([]);
    expect(hits('passive-voice', 'The being smiled. A being moved.')).toEqual([]);
    // Controls: a real passive after "the being", and shouted caps, are still flagged.
    expect(hits('passive-voice', 'The being was summoned.')).toEqual(['was summoned']);
    expect(hits('passive-voice', 'IT WAS ABANDONED.')).toEqual(['WAS ABANDONED']);
  });
});

describe('long-sentences', () => {
  const long = `${Array.from({ length: 31 }, (_, i) => `W${i}`).join(' ')}.`;

  it('flags sentences over the threshold and trims the range', () => {
    const text = `Short one. ${long}  `;
    const found = run('long-sentences', text);
    expect(found).toHaveLength(1);
    expect(text.slice(found[0].from, found[0].to)).toBe(long);
    expect(found[0].message).toBe('Long sentence (31 words)');
  });

  it('does not flag sentences at or under the threshold', () => {
    const thirty = `${Array.from({ length: 30 }, (_, i) => `W${i}`).join(' ')}.`;
    expect(run('long-sentences', `${thirty} Next.`)).toEqual([]);
    expect(run('long-sentences', `${thirty.slice(0, -1)} W30. Next.`)).toHaveLength(1);
    expect(
      run('long-sentences', 'Mr. Smith met Dr. Jones on St. Mark’s road. They spoke.')
    ).toEqual([]);
  });

  it('follows the threshold', () => {
    expect(
      run('long-sentences', 'One two three four five.', { ...TH, longSentenceWords: 4 })
    ).toHaveLength(1);
    expect(
      run('long-sentences', 'One two three four five.', { ...TH, longSentenceWords: 5 })
    ).toHaveLength(0);
  });

  it('keeps abbreviations, initials and dialogue tags inside one sentence', () => {
    const th = { ...TH, longSentenceWords: 5 };
    expect(hits('long-sentences', 'Mr. Smith met J. R. Tolkien.', th)).toEqual([
      'Mr. Smith met J. R. Tolkien.',
    ]);
    expect(hits('long-sentences', '“Wait!” she said to him again.', th)).toEqual([
      '“Wait!” she said to him again.',
    ]);
    // A paragraph end closes the sentence.
    expect(run('long-sentences', paras('One two three', 'four five six'), th)).toEqual([]);
  });

  it('does not treat every single capital before a full stop as an initial', () => {
    const th = { ...TH, longSentenceWords: 5 };
    expect(hits('long-sentences', 'He got an A. Then he went home to sleep.', th)).toEqual([
      'Then he went home to sleep.',
    ]);
    expect(computePrismStats(paras('He got an A. Then he went home.')).sentences).toBe(2);
    // Initials still hold a sentence together.
    expect(computePrismStats(paras('J. A. Smith left. A. Jones stayed.')).sentences).toBe(2);
    expect(computePrismStats(paras('We met John F. Kennedy there.')).sentences).toBe(1);
    expect(computePrismStats(paras('He got an A. Maybe next time.')).sentences).toBe(2);
    expect(computePrismStats(paras('He got an A. Marcus did not.')).sentences).toBe(2);
    expect(computePrismStats(paras('We met F. Scott Fitzgerald.')).sentences).toBe(1);
  });

  it('ends a sentence at the pronoun I', () => {
    const th = { ...TH, longSentenceWords: 5 };
    expect(computePrismStats(paras('So did I. Marcus left.')).sentences).toBe(2);
    expect(computePrismStats(paras('Neither did I. Elena ran.')).sentences).toBe(2);
    expect(computePrismStats(paras('It was me and I. Nobody else.')).sentences).toBe(2);
    expect(computePrismStats(paras('Not I. Elena ran.')).sentences).toBe(2);
    expect(hits('long-sentences', 'So did I. Marcus left the room in a hurry.', th)).toEqual([
      'Marcus left the room in a hurry.',
    ]);
    // A name before it, or an initial after it, still makes it an initial.
    expect(computePrismStats(paras('We read Isaac I. Newton today.')).sentences).toBe(1);
    expect(computePrismStats(paras('We met Ann I. Lee and J. I. M. Stewart.')).sentences).toBe(1);
  });
});

describe('filter-words', () => {
  it('flags filter words in narration', () => {
    const found = run('filter-words', 'She felt the cold. He heard a shot and saw smoke.');
    expect(hits('filter-words', 'She felt the cold. He heard a shot and saw smoke.')).toEqual([
      'felt',
      'heard',
      'saw',
    ]);
    expect(found[0].message).toBe('Filter word: ‘felt’');
  });

  it('flags across paragraphs after dialogue closes', () => {
    expect(hits('filter-words', paras('“Go,” he said.', 'She wondered why.'))).toEqual([
      'wondered',
    ]);
  });

  it('skips dialogue, noun uses and partial words', () => {
    expect(hits('filter-words', '“I saw it,” he said. "We heard you."')).toEqual([]);
    expect(
      hits('filter-words', 'He checked his watch. A thought struck. Seesaw and feelers.')
    ).toEqual([]);
    expect(hits('filter-words', '“I saw it,” he said, and she saw it too.')).toEqual(['saw']);
  });

  it('skips single-quoted (UK style) speech', () => {
    expect(hits('filter-words', "'I saw him,' she said. 'I felt it too.'")).toEqual([]);
    expect(hits('filter-words', '‘I saw him,’ she said, and she felt it.')).toEqual(['felt']);
  });

  it('does not read an inch mark as the start of speech', () => {
    expect(hits('filter-words', 'He was 6\'2" and broad. He saw the door.')).toEqual(['saw']);
    expect(hits('filter-words', 'A 12" ruler lay there. She saw it.')).toEqual(['saw']);
  });
});

describe('dialogue-tags', () => {
  it('flags showy tags after and before the quote', () => {
    const found = run('dialogue-tags', '“Get out!” she hissed.');
    expect(hits('dialogue-tags', '“Get out!” she hissed.')).toEqual(['hissed']);
    expect(found[0].message).toBe('Showy dialogue tag: ‘hissed’');
    expect(hits('dialogue-tags', 'Tom leaned in and growled, “Leave.”')).toEqual(['growled']);
    expect(hits('dialogue-tags', '“Fine,” Tom retorted.')).toEqual(['retorted']);
  });

  it('flags a plain tag propped up by an adverb', () => {
    const found = run('dialogue-tags', '“Fine,” she said angrily.');
    expect(hits('dialogue-tags', '“Fine,” she said angrily.')).toEqual(['said angrily']);
    expect(found[0].message).toBe('Dialogue tag propped up by an adverb: ‘said angrily’');
    expect(hits('dialogue-tags', 'He quietly asked, "Why?"')).toEqual(['quietly asked']);
  });

  it('leaves plain tags, acceptable tags and action beats alone', () => {
    expect(
      hits('dialogue-tags', '“Fine,” she said. “Why?” he asked. “Down,” she whispered.')
    ).toEqual([]);
    expect(hits('dialogue-tags', '“Sure.” She laughed.')).toEqual([]);
    expect(hits('dialogue-tags', '“Sure!” She laughed.')).toEqual([]);
    expect(hits('dialogue-tags', '“Go,” she said, and laughed.')).toEqual([]);
    expect(hits('dialogue-tags', 'She laughed. “Go.”')).toEqual([]);
    expect(hits('dialogue-tags', 'She hissed at the cat and left.')).toEqual([]);
    // Control: the same verb used as the tag itself is flagged.
    expect(hits('dialogue-tags', '“Sure,” she laughed.')).toEqual(['laughed']);
  });

  it('treats a capitalised word after ! or ? as an action beat unless the verb follows it', () => {
    expect(hits('dialogue-tags', '“Go!” Then he laughed.')).toEqual([]);
    expect(hits('dialogue-tags', '“Stop!” Suddenly she smiled.')).toEqual([]);
    // Control: a name followed directly by the verb is a tag.
    expect(hits('dialogue-tags', '“Go!” Elena hissed.')).toEqual(['hissed']);
    expect(hits('dialogue-tags', '“Why?” Elena said softly.')).toEqual(['said softly']);
  });

  it('does not read a capitalised -ly name as an adverb', () => {
    expect(hits('dialogue-tags', '“Hi,” Brockly said.')).toEqual([]);
    expect(hits('dialogue-tags', '“Hi,” said Brockly.')).toEqual([]);
    expect(hits('dialogue-tags', 'Brockly said, “Hi.”')).toEqual([]);
    expect(hits('dialogue-tags', '“Hi,” Carly said.')).toEqual([]);
    // Control: a lowercase adverb next to the tag is still flagged.
    expect(hits('dialogue-tags', '“Hi,” Brockly said softly.')).toEqual(['said softly']);
  });

  it('reads tags after single-quoted speech', () => {
    expect(hits('dialogue-tags', "'Go!' she hissed.")).toEqual(['hissed']);
    expect(hits('dialogue-tags', '‘Fine,’ she said angrily.')).toEqual(['said angrily']);
  });

  it('reports a tag shared by two quotes once', () => {
    expect(hits('dialogue-tags', '“Go,” she snapped, “now.”')).toEqual(['snapped']);
  });
});

describe('repeated-starts', () => {
  it('flags the first word of the 2nd+ sentence in a run', () => {
    const found = run('repeated-starts', 'Rain fell. Rain pooled. Rain rose.');
    expect(hits('repeated-starts', 'Rain fell. Rain pooled. Rain rose.')).toEqual(['Rain', 'Rain']);
    expect(found[0].message).toBe('3 sentences in a row start with ‘Rain’');
    expect(found[0].from).toBe(11);
  });

  it('needs three in a row for very common openers, across paragraphs', () => {
    expect(hits('repeated-starts', 'He ran. He hid.')).toEqual([]);
    expect(hits('repeated-starts', paras('He ran.', 'He hid.', 'He waited.'))).toEqual([
      'He',
      'He',
    ]);
  });

  it('ignores non-consecutive repeats and speech', () => {
    expect(hits('repeated-starts', 'Rain fell. Wind rose. Rain fell.')).toEqual([]);
    expect(hits('repeated-starts', '“No.” “No!” “No?”')).toEqual([]);
    expect(hits('repeated-starts', 'Rain fell. Rain fell.')).toEqual(['Rain']);
  });

  it('treats a sentence opening on an inline mention as starting with that mention', () => {
    expect(hits('repeated-starts', '\uFFFC nodded. \uFFFC nodded too.')).toEqual([]);
    expect(hits('repeated-starts', '\uFFFC’s sword gleamed. \uFFFC’s shield cracked.')).toEqual([]);
    expect(hits('repeated-starts', 'Rain fell. \uFFFC ran. Rain rose.')).toEqual([]);
    // Control: the same sentences with plain-text names.
    expect(hits('repeated-starts', 'Elena nodded. Elena nodded too.')).toEqual(['Elena']);
  });

  it('ignores single-quoted speech and a stammer across an ellipsis', () => {
    expect(hits('repeated-starts', "'No. No. No!' she said.")).toEqual([]);
    expect(hits('repeated-starts', 'I... I... I don’t know, she thought.')).toEqual([]);
    expect(hits('repeated-starts', 'I… I… I don’t know, she thought.')).toEqual([]);
    expect(computePrismStats(paras('I... I... I don’t know, she thought.')).sentences).toBe(1);
    // Control: different words around the ellipsis still end sentences.
    expect(hits('repeated-starts', 'I ran... I hid... I waited.')).toEqual(['I', 'I']);
  });
});

describe('punctuation-consistency', () => {
  it('flags the minority double-quote style', () => {
    const text = '“One,” he said. “Two,” she said. "Three."';
    const found = run('punctuation-consistency', text);
    expect(found.map((f) => f.from)).toEqual([text.indexOf('"'), text.lastIndexOf('"')]);
    expect(found[0].message).toBe('Mixed quote styles: this scene mostly uses curly quotes');
  });

  it('flags straight quotes on a tie and curly when straight wins, scene-wide', () => {
    expect(hits('punctuation-consistency', paras('“A”', '"B"'))).toEqual(['"', '"']);
    const found = run('punctuation-consistency', paras('"A" "B"', '“C”'));
    expect(found.map((f) => f.paragraph)).toEqual([1, 1]);
    expect(found[0].message).toBe('Mixed quote styles: this scene mostly uses straight quotes');
  });

  it('flags mixed apostrophes, counting apostrophes inside words', () => {
    const found = run('punctuation-consistency', "It’s Tom’s dog, isn't it?");
    expect(found).toHaveLength(1);
    expect(found[0].message).toBe(
      'Mixed apostrophe styles: this scene mostly uses curly apostrophes'
    );
  });

  it('flags minority dash styles', () => {
    const text = 'Wait—no—stop -- now.';
    const found = run('punctuation-consistency', text);
    expect(found.map((f) => text.slice(f.from, f.to))).toEqual(['--']);
    expect(found[0].message).toBe('Mixed dash styles: this scene mostly uses em dashes (—)');
    expect(hits('punctuation-consistency', 'Go – now. Wait—')).toEqual(['–']);
  });

  it('stays quiet when a scene is consistent', () => {
    expect(run('punctuation-consistency', '“It’s fine,” she said—quietly.')).toEqual([]);
    expect(run('punctuation-consistency', `"It's fine," she said -- quietly.`)).toEqual([]);
    expect(run('punctuation-consistency', 'Pages 10–12—and more.')).toEqual([]);
    expect(hits('punctuation-consistency', 'Pages 10 – 12—and more—again.')).toEqual(['–']);
  });
});

describe('dialogue tint', () => {
  it('spans from the opening to the closing quote inclusive', () => {
    expect(hits('dialogue', '“Hi,” she said, “there.” Then "bye" too.')).toEqual([
      '“Hi,”',
      '“there.”',
      '"bye"',
    ]);
  });

  it('runs an unclosed quote to the end of its paragraph only', () => {
    const ps = paras('“First part of the speech.', '“Second part.”');
    expect(hits('dialogue', ps)).toEqual(['“First part of the speech.', '“Second part.”']);
  });

  it('emits nothing without quotes', () => {
    expect(run('dialogue', 'No speech here.')).toEqual([]);
    expect(hits('dialogue', 'Some "speech" here.')).toEqual(['"speech"']);
  });

  it('pairs single quotes (UK style) without matching apostrophes', () => {
    expect(hits('dialogue', "'I saw him,' she said. 'I felt it too.'")).toEqual([
      "'I saw him,'",
      "'I felt it too.'",
    ]);
    expect(hits('dialogue', '‘I saw the twins’ dog,’ she said.')).toEqual([
      '‘I saw the twins’ dog,’',
    ]);
    expect(hits('dialogue', "'I saw 'em,' she said.")).toEqual(["'I saw 'em,'"]);
    expect(hits('dialogue', 'He said “I’m off,” and left.')).toEqual(['“I’m off,”']);
    expect(run('dialogue', "It's Tom's dog and the twins' cat. He loved rock 'n' roll.")).toEqual(
      []
    );
    expect(run('dialogue', "He called it 'the thing' and left.")).toEqual([]);
    expect(run('dialogue', "'Twas the night before. 'Tis cold.")).toEqual([]);
    const ps = paras("'First part of the speech.", "'Second part.'");
    expect(hits('dialogue', ps)).toEqual(["'First part of the speech.", "'Second part.'"]);
  });

  it('does not pair a stray single quote with a later quote’s closer', () => {
    expect(hits('dialogue', "Everyone called him 'the Major'. 'Sit down,' he said.")).toEqual([
      "'Sit down,'",
    ]);
    expect(hits('dialogue', "'the Major' was his name. 'Sit,' he said.")).toEqual(["'Sit,'"]);
    expect(
      hits('filter-words', "They called it 'the Pit' and he saw nothing. 'Sit,' he said.")
    ).toEqual(['saw']);
    expect(hits('dialogue', 'The so-called ‘experts’ argued. “He said ‘no,’ ” she said.')).toEqual([
      '“He said ‘no,’ ”',
    ]);
    // Double quotes nested in UK-style speech stay inside it.
    expect(hits('dialogue', '‘He said “no,” then left,’ she said.')).toEqual([
      '‘He said “no,” then left,’',
    ]);
    expect(hits('dialogue', '‘He said “no”’ and left.')).toEqual(['‘He said “no”’']);
    expect(hits('dialogue', `'He said "no," then left,' she said.`)).toEqual([
      `'He said "no," then left,'`,
    ]);
  });

  it('reads a capitalised elision at the paragraph start as narration', () => {
    expect(run('dialogue', "'Course I will. He saw the door.")).toEqual([]);
    expect(run('dialogue', "'Cause I said so. He saw the door.")).toEqual([]);
    expect(hits('filter-words', "'Course I will. He saw the door.")).toEqual(['saw']);
    expect(hits('dialogue', "'Ello, 'ello. He saw it. 'Stop,' he said.")).toEqual(["'Stop,'"]);
    // A capital name that looks like an elision is speech.
    expect(hits('dialogue', "'Em, come here,' she said.")).toEqual(["'Em, come here,'"]);
  });

  it('does not read an inch or prime mark as a quote', () => {
    expect(run('dialogue', 'He was 6\'2" and broad. He saw the door.')).toEqual([]);
    expect(hits('dialogue', '"He is 6\'2" tall," she said.')).toEqual(['"He is 6\'2" tall,"']);
  });
});

describe('inner-monologue tint', () => {
  it('covers italic runs outside dialogue, trimmed', () => {
    const text = 'She paused. Not again. Then on.';
    const from = text.indexOf('Not') - 1;
    const found = run('inner-monologue', [{ text, italic: [[from, from + 12]] }]);
    expect(found.map((f) => text.slice(f.from, f.to))).toEqual(['Not again.']);
  });

  it('skips italics inside dialogue and keeps the part outside', () => {
    const text = '“Stop,” she said. Why now?';
    expect(run('inner-monologue', [{ text, italic: [[1, 5]] }])).toEqual([]);
    const found = run('inner-monologue', [{ text, italic: [[0, text.length]] }]);
    expect(found.map((f) => text.slice(f.from, f.to))).toEqual(['she said. Why now?']);
  });

  it('emits nothing without italics', () => {
    expect(run('inner-monologue', 'Plain prose.')).toEqual([]);
    expect(hits('inner-monologue', [{ text: 'Plain prose.', italic: [[0, 5]] }])).toEqual([
      'Plain',
    ]);
  });
});

describe('narrator tint', () => {
  it('covers text outside dialogue and inner monologue', () => {
    const text = '“Hi,” she said, “there.” Why? He left.';
    const why = text.indexOf('Why');
    const found = run('narrator', [{ text, italic: [[why, why + 4]] }]);
    expect(found.map((f) => text.slice(f.from, f.to))).toEqual(['she said,', 'He left.']);
  });

  it('emits no empty or whitespace-only ranges', () => {
    expect(run('narrator', '“One.” “Two.”')).toEqual([]);
    expect(run('narrator', paras('', '   '))).toEqual([]);
    expect(hits('narrator', paras('', '  Told.  '))).toEqual(['Told.']);
  });
});

describe('offsets and U+FFFC', () => {
  it('slices exactly the flagged phrase for every finding', () => {
    const text = 'He was struck hard. “Go!” she hissed, very loudly.';
    const { findings } = runPrismRules(paras(text), TH);
    for (const f of findings) {
      expect(f.from).toBeGreaterThanOrEqual(0);
      expect(f.to).toBeLessThanOrEqual(text.length);
      expect(f.to).toBeGreaterThan(f.from);
    }
    const slice = (id: PrismCheckId) =>
      findings.filter((f) => f.checkId === id).map((f) => text.slice(f.from, f.to));
    expect(slice('passive-voice')).toEqual(['was struck']);
    expect(slice('dialogue-tags')).toEqual(['hissed']);
    expect(slice('crutch-words')).toEqual(['very']);
    expect(slice('adverbs')).toEqual(['loudly']);
  });

  it('treats U+FFFC as a word boundary', () => {
    const text = 'She met \uFFFC and \uFFFCquickly\uFFFC left.';
    expect(hits('adverbs', text)).toEqual(['quickly']);
    expect(computePrismStats(paras(text)).words).toBe(5);
    expect(computePrismStats(paras('\uFFFC \uFFFC')).words).toBe(0);
    // An atom alone is still narration.
    expect(hits('narrator', '\uFFFC')).toEqual(['\uFFFC']);
  });
});

describe('runPrismRules', () => {
  it('runs every check and sorts by paragraph, from, to, checkId', () => {
    const ps = paras('“Really?” she hissed.', 'He felt it quickly. He was taken.');
    const { findings } = runPrismRules(ps, TH);
    const ids = new Set(findings.map((f) => f.checkId));
    for (const id of [
      'crutch-words',
      'dialogue-tags',
      'filter-words',
      'adverbs',
      'passive-voice',
      'dialogue',
      'narrator',
    ]) {
      expect(ids.has(id as PrismCheckId)).toBe(true);
    }
    const sorted = [...findings].sort(
      (x, y) =>
        x.paragraph - y.paragraph ||
        x.from - y.from ||
        x.to - y.to ||
        (x.checkId < y.checkId ? -1 : x.checkId > y.checkId ? 1 : 0)
    );
    expect(findings).toEqual(sorted);
    expect(findings[0].paragraph).toBe(0);
    // The union of the per-check rules is exactly what runPrismRules returns.
    const union = PRISM_CHECK_IDS.flatMap((id) => PRISM_RULES[id](ps, TH));
    expect(findings).toHaveLength(union.length);
  });

  it('returns nothing for an empty scene', () => {
    expect(runPrismRules([], TH)).toEqual({
      findings: [],
      stats: { words: 0, sentences: 0, avgSentenceWords: 0, readingEase: null },
    });
  });

  it('handles 10k words quickly', () => {
    const para =
      '“Really?” she hissed, and the grim captain was taken quickly below. He felt the deck shudder — the old ship ' +
      'was being torn apart. Rain fell. Rain pooled. She wondered whether anyone would ever find them again.';
    const ps = paras(...Array.from({ length: 300 }, () => para));
    runPrismRules(ps, TH); // warm up the JIT
    const t0 = performance.now();
    const result = runPrismRules(ps, TH);
    const ms = performance.now() - t0;
    expect(result.stats.words).toBeGreaterThan(9000);
    expect(result.findings.length).toBeGreaterThan(1000);
    expect(ms).toBeLessThan(200);
  });

  it('handles 50k words in a single block quickly', () => {
    // A dialogue-heavy chapter pasted into one textblock (hard breaks become
    // "\n"): thousands of speech spans and sentences in the same paragraph.
    const para =
      '“Really?” she hissed, and the grim captain was taken quickly below. “Go,” he said. He felt the deck ' +
      'shudder — the old ship was being torn apart. Rain fell. Rain pooled. She wondered whether anyone ' +
      'would ever find them again. “No.” “Yes.” “Why?” “Now.” “Stop.” “Wait.” “Here.” “There.” “Run.” ' +
      '“Hide.” “Look.” “Down.”';
    const text = Array.from({ length: 1050 }, () => para).join('\n');
    const ps = paras(text);
    runPrismRules(ps, TH); // warm up the JIT
    const t0 = performance.now();
    const result = runPrismRules(ps, TH);
    const ms = performance.now() - t0;
    expect(result.stats.words).toBeGreaterThan(50000);
    expect(result.findings.length).toBeGreaterThan(5000);
    expect(ms).toBeLessThan(400);
  });
});

describe('computePrismStats', () => {
  it('counts words and sentences and averages them', () => {
    const stats = computePrismStats(paras('The cat sat. The dog ran far away!', 'Mr. Smith left.'));
    expect(stats.words).toBe(11);
    expect(stats.sentences).toBe(3);
    expect(stats.avgSentenceWords).toBe(3.7);
  });

  it('scores simple prose easier than dense prose, clamped to 0..100', () => {
    const easy = computePrismStats(paras('The cat sat. The dog ran. We had fun.')).readingEase;
    const hard = computePrismStats(
      paras(
        'Notwithstanding considerable institutional reluctance, the administrative committee unanimously ' +
          'recommended comprehensive organizational restructuring, prioritizing interdepartmental communication.'
      )
    ).readingEase;
    expect(easy).not.toBeNull();
    expect(hard).not.toBeNull();
    expect(easy as number).toBeGreaterThan(hard as number);
    expect(easy as number).toBeLessThanOrEqual(100);
    expect(hard as number).toBeGreaterThanOrEqual(0);
    expect(Number.isInteger(easy)).toBe(true);
  });

  it('returns null reading ease and zero average with no words', () => {
    expect(computePrismStats(paras('', '— …'))).toEqual({
      words: 0,
      sentences: 0,
      avgSentenceWords: 0,
      readingEase: null,
    });
    expect(computePrismStats(paras('One.')).readingEase).not.toBeNull();
  });

  it('matches the stats runPrismRules returns', () => {
    const ps = paras('A short scene. It ends here.');
    expect(runPrismRules(ps, TH).stats).toEqual(computePrismStats(ps));
    expect(computePrismStats(ps)).toMatchObject({ words: 6, sentences: 2, avgSentenceWords: 3 });
  });
});
