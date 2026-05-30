function stripMarkdown(text: string): string {
  return (
    text
      // Fenced code blocks — strip fences, keep content
      .replace(/```[^\n]*\n([\s\S]*?)```/g, '$1')
      // Inline code — strip backticks, keep content
      .replace(/`([^`\n]+)`/g, '$1')
      // Images (no readable text)
      .replace(/!\[[^\]]*\]\([^)]*\)/g, ' ')
      // Links — keep display text, drop URL
      .replace(/\[([^\]]+)\]\([^)]*\)/g, '$1')
      // ATX headings — strip leading # markers
      .replace(/^#{1,6}\s+/gm, '')
      // Bold / italic / bold-italic (asterisk)
      .replace(/\*{1,3}([^*\n]+)\*{1,3}/g, '$1')
      // Bold / italic / bold-italic (underscore)
      .replace(/_{1,3}([^_\n]+)_{1,3}/g, '$1')
      // Strikethrough
      .replace(/~~([^~\n]+)~~/g, '$1')
      // Unordered list bullets
      .replace(/^[-*+]\s+/gm, '')
      // Ordered list numbers
      .replace(/^\d+\.\s+/gm, '')
      // Blockquotes
      .replace(/^>\s?/gm, '')
      // Horizontal rules
      .replace(/^[-*_]{3,}\s*$/gm, '')
  );
}

export function countWords(text: string): number {
  if (!text.trim()) return 0;
  return stripMarkdown(text)
    .split(/\s+/)
    .filter(Boolean).length;
}

export function readingTimeMinutes(words: number): number {
  if (words === 0) return 0;
  return Math.ceil(words / 238);
}
