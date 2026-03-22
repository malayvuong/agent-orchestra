const EXTERNAL_LINK_PATTERN = /^(?:[a-z]+:)?\/\//i
const PLAIN_TEXT_PATH_PATTERN =
  /(?:^|[\s`("'[\]])((?:\/|\.{1,2}\/)?[A-Za-z0-9._-]+(?:\/[A-Za-z0-9._-]+)+\.[A-Za-z0-9]{1,10})(?=$|[\s`)"'\],:;.!?])/gm

export function extractMarkdownLinks(markdown: string): string[] {
  const matches = markdown.matchAll(/\[[^\]]*]\(([^)]+)\)/g)
  const links: string[] = []

  for (const match of matches) {
    const rawTarget = match[1]?.trim()
    if (!rawTarget) continue

    const targetWithoutTitle = rawTarget.split(/\s+/)[0]
    const target = targetWithoutTitle.split('#')[0]?.split('?')[0] ?? ''

    if (!target) continue
    if (target.startsWith('#')) continue
    if (EXTERNAL_LINK_PATTERN.test(target)) continue
    if (target.startsWith('mailto:')) continue

    links.push(target)
  }

  return links
}

export function extractMarkdownReferences(markdown: string): string[] {
  const references = new Set<string>(extractMarkdownLinks(markdown))

  for (const match of markdown.matchAll(PLAIN_TEXT_PATH_PATTERN)) {
    const candidate = match[1]?.trim()
    if (!candidate) continue
    if (candidate.includes('://')) continue
    if (candidate.startsWith('#')) continue
    references.add(candidate)
  }

  return [...references]
}
