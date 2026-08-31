import { describe, it, expect } from 'vitest'
import { clean, splitSubProject, matchSubProjects, subProjectsFor } from './subproject-match'

const PROJECTS = [
  { id: 'p-vv',   code: 'VV Infra',  name: 'VV Infra' },
  { id: 'p-vvce', code: 'VVCE',      name: 'Vinay Vivek Common Expenses' },
  { id: 'p-vinay', code: 'VINAY',    name: 'VINAY' },
  { id: 'p-ngha', code: 'NGH A',     name: 'NGH A' },
  { id: 'p-osh',  code: 'OSH',       name: 'Old Swadhyay Hall' },
]

describe('clean', () => {
  // Real sub-project names carry these. They break every string comparison
  // and are invisible in any log, so stripping them is not optional.
  it('strips zero-width characters', () => {
    expect(clean('Old Swadhyay Hall - ⁠Design')).toBe('Old Swadhyay Hall - Design')
    expect(clean('A​B')).toBe('AB')
  })

  it('collapses runs of whitespace', () => {
    expect(clean('  P2   Infra  ')).toBe('P2 Infra')
  })
})

describe('splitSubProject', () => {
  it('splits the dashed form', () => {
    expect(splitSubProject('Vinay Vivek Infra - Execution'))
      .toEqual({ base: 'Vinay Vivek Infra', stage: 'Execution' })
  })

  it('splits the bare form, which has no dash', () => {
    expect(splitSubProject('Vinay Vivek Common Expenses'))
      .toEqual({ base: 'Vinay Vivek', stage: 'Common Expenses' })
  })

  // "SRMD Ashram ICT Team" must not be shortened by a lesser suffix first.
  it('prefers the longest stage suffix', () => {
    expect(splitSubProject('Admin Block - SRMD Ashram ICT Team'))
      .toEqual({ base: 'Admin Block', stage: 'SRMD Ashram ICT Team' })
  })

  it('leaves a name with no stage alone', () => {
    expect(splitSubProject('NGH A')).toEqual({ base: 'NGH A', stage: null })
  })

  it('never strips a name down to nothing', () => {
    // The whole name IS a stage word — keep it rather than returning ''.
    expect(splitSubProject('Design').base).toBe('Design')
  })

  // Aksha, 2026-08-31: Infra is a separate PROJECT, not a stage. Stripping it
  // would merge "Raj Uphaar - Infra Work" (₹9.98 Cr) into Raj Uphaar, and
  // "P2 Row Houses - Infra Work" into P2 Row Houses — both wrong.
  it('does NOT treat "Infra Work" as a stage', () => {
    expect(splitSubProject('Raj Uphaar - Infra Work'))
      .toEqual({ base: 'Raj Uphaar - Infra Work', stage: null })
    expect(splitSubProject('P2 Row Houses - Infra Work'))
      .toEqual({ base: 'P2 Row Houses - Infra Work', stage: null })
  })

  it('still strips a real stage that follows Infra Work', () => {
    expect(splitSubProject('P2 Row Houses - Infra Work - Execution'))
      .toEqual({ base: 'P2 Row Houses - Infra Work', stage: 'Execution' })
  })

  it('handles the en-dash and em-dash separators too', () => {
    expect(splitSubProject('Sheth House – Design').stage).toBe('Design')
    expect(splitSubProject('Sheth House — Design').stage).toBe('Design')
  })
})

describe('matchSubProjects', () => {
  it('matches on the full name when it already lines up', () => {
    const [m] = matchSubProjects(['Vinay Vivek Common Expenses'], PROJECTS)
    expect(m.projectId).toBe('p-vvce')
  })

  it('matches on the base once the stage is stripped', () => {
    const [m] = matchSubProjects(['NGH A - Execution'], PROJECTS)
    expect(m.projectId).toBe('p-ngha')
    expect(m.stage).toBe('Execution')
  })

  it('matches on the project code when the name does not match', () => {
    const [m] = matchSubProjects(['VV Infra - Execution'], PROJECTS)
    expect(m.projectId).toBe('p-vv')
  })

  // The whole point: an unmatched sub-project is REPORTED, never guessed onto
  // a nearby project and never silently dropped.
  it('returns unmatched rather than guessing', () => {
    const [m] = matchSubProjects(['Prem Parking - Execution'], PROJECTS)
    expect(m.projectId).toBeNull()
    expect(m.base).toBe('Prem Parking')
  })

  it('does not match a different project that merely starts the same', () => {
    const [m] = matchSubProjects(['Vinay ST - Execution'], PROJECTS)
    expect(m.projectId).toBeNull()   // "Vinay ST" is not "VINAY"
  })

  it('groups every stage of one project together', () => {
    const matches = matchSubProjects(
      ['NGH A - Execution', 'NGH A - Design', 'NGH A - Professional Consultancy', 'Other - Execution'],
      PROJECTS,
    )
    expect(subProjectsFor(matches, 'p-ngha')).toEqual([
      'NGH A - Execution', 'NGH A - Design', 'NGH A - Professional Consultancy',
    ])
  })

  it('is case- and punctuation-insensitive', () => {
    const [m] = matchSubProjects(['old  swadhyay   hall - design'], PROJECTS)
    expect(m.projectId).toBe('p-osh')
  })
})

describe('stated aliases', () => {
  const P = [
    { id: 'p-ngha', code: 'NGH A',  name: 'NGH A' },
    { id: 'p-a01',  code: 'P2 A01', name: 'P2 A01' },
    { id: 'p-srah', code: 'SRAH',   name: 'SRAH' },
  ]
  const A = [
    { in4: 'New Guest House A', hub: 'NGH A' },
    { in4: 'P2 Stepped Terraces - Execution A-01', hub: 'P2 A01' },
    { in4: 'SR Animal Hospital', hub: 'SRAH' },
  ]

  it('bridges the spelling gap that string matching cannot', () => {
    const m = matchSubProjects(['New Guest House A-Execution'], P, A)[0]
    expect(m.projectId).toBe('p-ngha')
    expect(m.via).toBe('alias')
  })

  // This one only works if aliases are checked on the FULL name before the
  // stage is stripped — the bare base "P2 Stepped Terraces" is a different
  // thing entirely, and matching it to A01 would be wrong.
  it('matches an alias that only makes sense before the stage is stripped', () => {
    const m = matchSubProjects(['P2 Stepped Terraces - Execution A-01'], P, A)[0]
    expect(m.projectId).toBe('p-a01')
    expect(m.via).toBe('alias')
  })

  it('records HOW each one matched, so the review screen can separate them', () => {
    const [alias, auto] = matchSubProjects(['SR Animal Hospital', 'SRAH - Execution'], P, A)
    expect(alias.via).toBe('alias')
    expect(auto.via).toBe('name')
  })

  // A typo'd alias target must fail closed, not attach money somewhere random.
  it('ignores an alias pointing at a project that does not exist', () => {
    const m = matchSubProjects(['New Guest House A'], P, [{ in4: 'New Guest House A', hub: 'Nowhere' }])[0]
    expect(m.projectId).toBeNull()
  })

  it('changes nothing when no aliases are supplied', () => {
    expect(matchSubProjects(['New Guest House A-Execution'], P)[0].projectId).toBeNull()
  })
})

// Measured against all 102 real sub-project names on 2026-08-30: stripping the
// stage lifts automatic matching from 7 to 18. The rest fail for four reasons,
// and they are recorded here because each needs a DIFFERENT fix — a synonym
// table would paper over all four and quietly put money on wrong projects.
describe('why the remaining sub-projects do not match (documented, not fixed)', () => {
  const P = [
    { id: 'p-ngha', code: 'NGH A', name: 'NGH A' },
    { id: 'p-ek',   code: 'EK',    name: 'Ekant Kutir' },
    { id: 'p-ab1f', code: 'AB1F',  name: 'Admin Block 1st Floor' },
    { id: 'p-a01',  code: 'P2 A01', name: 'P2 A01' },
  ]

  it('1. IN4 spells the project differently — needs a confirmed alias, not a guess', () => {
    // "New Guest House A" is NGH A. Only a human can safely say so.
    expect(matchSubProjects(['New Guest House A-Execution'], P)[0].projectId).toBeNull()
  })

  it('2. singular vs plural — still a rename someone must confirm', () => {
    expect(matchSubProjects(['Ekant Kutirs - Execution'], P)[0].projectId).toBeNull()
  })

  it('3. an extra word IN4 adds', () => {
    expect(matchSubProjects(['Admin Block 1st Floor Work - Execution'], P)[0].projectId).toBeNull()
  })

  it('4. the stage carries the building — "Execution A-01" means P2 A01', () => {
    const m = matchSubProjects(['P2 Stepped Terraces - Execution A-01'], P)[0]
    expect(m.projectId).toBeNull()
    expect(m.stage).toBeNull()   // "Execution A-01" is not a plain stage
  })

  it('MULTIPLE is IN4\'s own catch-all and can never be attributed', () => {
    expect(matchSubProjects(['MULTIPLE'], P)[0].projectId).toBeNull()
  })
})
