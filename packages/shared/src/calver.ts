const CALVER_RE = /^(?<year>\d{4})\.(?<month>[1-9]|1[0-2])\.(?<patch>[1-9]\d*)$/

export type CalverParts = {
  year: number
  month: number
  patch: number
}

export function isValidCalver(version: string): boolean {
  return CALVER_RE.test(version)
}

export function parseCalver(version: string): CalverParts {
  const match = CALVER_RE.exec(version)
  if (!match?.groups) {
    throw new Error(`Invalid CalVer: ${version}`)
  }

  return {
    year: Number(match.groups.year),
    month: Number(match.groups.month),
    patch: Number(match.groups.patch),
  }
}

export function compareCalver(a: string, b: string): number {
  const partsA = parseCalver(a)
  const partsB = parseCalver(b)

  if (partsA.year !== partsB.year) return partsA.year - partsB.year
  if (partsA.month !== partsB.month) return partsA.month - partsB.month
  return partsA.patch - partsB.patch
}
