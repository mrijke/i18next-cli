import { vol } from 'memfs'
import { vi, describe, it, expect, beforeEach, afterEach } from 'vitest'
import { resolve } from 'path'
import type { I18nextToolkitConfig } from '../src/index'

// Mock filesystem used by extractor (both sync and promises layers)
vi.mock('fs', async () => {
  const memfs = await vi.importActual<typeof import('memfs')>('memfs')
  return memfs.fs
})
vi.mock('fs/promises', async () => {
  const memfs = await vi.importActual<typeof import('memfs')>('memfs')
  return memfs.fs.promises
})

// Mock glob so extractor only scans test files we create in memfs
vi.mock('glob', () => ({ glob: vi.fn() }))

// Import runStatus AFTER mocks so internal modules use the mocked fs/glob
const { runStatus } = await import('../src/index')

const mockConfig: I18nextToolkitConfig = {
  locales: ['en', 'de', 'fr'],
  extract: {
    input: ['src/**/*.{ts,tsx}'],
    output: 'locales/{{language}}/{{namespace}}.json',
  },
}

describe('status (--hide-translated)', () => {
  let consoleLogSpy: any

  beforeEach(async () => {
    vol.reset()
    vi.clearAllMocks()
    const { glob } = await import('glob')
    vi.mocked(glob).mockImplementation(async (pattern: any, options?: any) => {
      return Object.keys(vol.toJSON()).filter(p => p.includes('/src/'))
    })
    consoleLogSpy = vi.spyOn(console, 'log').mockImplementation(() => {})
    vi.spyOn(console, 'error').mockImplementation(() => {})
    vi.spyOn(process, 'exit').mockImplementation(() => {
      throw new Error('Process exit called')
    })
  })

  afterEach(() => {
    vi.restoreAllMocks()
  })

  it('should hide translated keys when hideTranslated is true', async () => {
    vol.fromJSON({
      [resolve(process.cwd(), 'src/app.ts')]: `
        import { t } from 'i18next'
        t('key.a')
        t('key.b')
        t('key.c')
      `,
      [resolve(process.cwd(), 'locales/de/translation.json')]: JSON.stringify({
        key: { a: 'Wert A', b: 'Wert B' },
      }),
    })

    try {
      await runStatus(mockConfig, { detail: 'de', hideTranslated: true })
    } catch (e) {
      // Expected to throw when process.exit is called
    }

    // key.c is NOT translated – it should be listed
    expect(consoleLogSpy).toHaveBeenCalledWith(expect.stringContaining('key.c'))
    // key.a and key.b ARE translated – they should NOT be listed
    expect(consoleLogSpy).not.toHaveBeenCalledWith(expect.stringMatching(/[✓✗]\s+key\.a/))
    expect(consoleLogSpy).not.toHaveBeenCalledWith(expect.stringMatching(/[✓✗]\s+key\.b/))
  })

  it('should still show all keys when hideTranslated is not set', async () => {
    vol.fromJSON({
      [resolve(process.cwd(), 'src/app2.ts')]: `
        import { t } from 'i18next'
        t('key.a')
        t('key.b')
        t('key.c')
      `,
      [resolve(process.cwd(), 'locales/de/translation.json')]: JSON.stringify({
        key: { a: 'Wert A', b: 'Wert B' },
      }),
    })

    try {
      await runStatus(mockConfig, { detail: 'de' })
    } catch (e) {
      // Expected
    }

    // All keys should be visible
    expect(consoleLogSpy).toHaveBeenCalledWith(expect.stringContaining('key.a'))
    expect(consoleLogSpy).toHaveBeenCalledWith(expect.stringContaining('key.b'))
    expect(consoleLogSpy).toHaveBeenCalledWith(expect.stringContaining('key.c'))
  })

  it('should show progress bars even when hiding translated keys', async () => {
    vol.fromJSON({
      [resolve(process.cwd(), 'src/app3.ts')]: `
        import { t } from 'i18next'
        t('key.x')
        t('key.y')
      `,
      [resolve(process.cwd(), 'locales/de/translation.json')]: JSON.stringify({
        key: { x: 'Wert X' },
      }),
    })

    try {
      await runStatus(mockConfig, { detail: 'de', hideTranslated: true })
    } catch (e) {
      // Expected
    }

    // Progress bars should still reflect the actual counts
    expect(consoleLogSpy).toHaveBeenCalledWith(expect.stringContaining('50% (1/2)'))
    // The untranslated key should be listed
    expect(consoleLogSpy).toHaveBeenCalledWith(expect.stringContaining('key.y'))
    // The translated key should NOT be listed
    expect(consoleLogSpy).not.toHaveBeenCalledWith(expect.stringMatching(/[✓✗]\s+key\.x/))
  })

  it('should combine hideTranslated with namespace filtering', async () => {
    vol.fromJSON({
      [resolve(process.cwd(), 'src/app4.ts')]: `
        import { t } from 'i18next'
        t('app.title')
        t('common:button.save')
        t('common:button.cancel')
      `,
      [resolve(process.cwd(), 'locales/de/translation.json')]: JSON.stringify({}),
      [resolve(process.cwd(), 'locales/de/common.json')]: JSON.stringify({
        button: { save: 'Speichern' },
      }),
    })

    try {
      await runStatus(mockConfig, { detail: 'de', namespace: 'common', hideTranslated: true })
    } catch (e) {
      // Expected
    }

    // button.cancel is untranslated in the 'common' namespace – should be listed
    expect(consoleLogSpy).toHaveBeenCalledWith(expect.stringContaining('button.cancel'))
    // button.save IS translated – should NOT be listed
    expect(consoleLogSpy).not.toHaveBeenCalledWith(expect.stringMatching(/[✓✗]\s+button\.save/))
    // app.title from 'translation' namespace should not appear (namespace filter)
    expect(consoleLogSpy).not.toHaveBeenCalledWith(expect.stringContaining('app.title'))
  })

  it('should show no keys when everything is translated and hideTranslated is true', async () => {
    vol.fromJSON({
      [resolve(process.cwd(), 'src/app5.ts')]: `
        import { t } from 'i18next'
        t('key.a')
        t('key.b')
      `,
      [resolve(process.cwd(), 'locales/de/translation.json')]: JSON.stringify({
        key: { a: 'Wert A', b: 'Wert B' },
      }),
      [resolve(process.cwd(), 'locales/fr/translation.json')]: JSON.stringify({
        key: { a: 'Valeur A', b: 'Valeur B' },
      }),
    })

    await runStatus(mockConfig, { detail: 'de', hideTranslated: true })

    // No key entries should be displayed at all
    expect(consoleLogSpy).not.toHaveBeenCalledWith(expect.stringMatching(/[✓✗]\s+key\./))
    // But the summary should still confirm all translations are present
    expect(consoleLogSpy).toHaveBeenCalledWith(expect.stringContaining('All keys are translated'))
  })

  it('should only affect the detailed view, not the summary view', async () => {
    vol.fromJSON({
      [resolve(process.cwd(), 'src/app6.ts')]: `
        import { t } from 'i18next'
        t('key.a')
        t('key.b')
      `,
      [resolve(process.cwd(), 'locales/de/translation.json')]: JSON.stringify({
        key: { a: 'Wert A' },
      }),
      [resolve(process.cwd(), 'locales/fr/translation.json')]: JSON.stringify({
        key: { a: 'Valeur A', b: 'Valeur B' },
      }),
    })

    try {
      // Summary view (no detail locale specified) should not be affected
      await runStatus(mockConfig, { hideTranslated: true })
    } catch (e) {
      // Expected
    }

    // Summary view should show locale progress lines as usual
    expect(consoleLogSpy).toHaveBeenCalledWith(expect.stringContaining('- de:'))
    expect(consoleLogSpy).toHaveBeenCalledWith(expect.stringContaining('- fr:'))
  })
})
