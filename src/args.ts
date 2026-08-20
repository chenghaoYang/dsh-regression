export interface ParsedArgs {
  positionals: string[]
  flags: Map<string, string[]>
}

export function parseArgs(argv: string[]): ParsedArgs {
  const positionals: string[] = []
  const flags = new Map<string, string[]>()
  for (let index = 0; index < argv.length; index += 1) {
    const token = argv[index]!
    if (!token.startsWith('--')) {
      positionals.push(token)
      continue
    }
    const equals = token.indexOf('=')
    const name = token.slice(2, equals === -1 ? undefined : equals)
    let value = equals === -1 ? undefined : token.slice(equals + 1)
    if (value === undefined && argv[index + 1] !== undefined && !argv[index + 1]!.startsWith('--')) value = argv[++index]
    const values = flags.get(name) ?? []
    values.push(value ?? 'true')
    flags.set(name, values)
  }
  return { positionals, flags }
}

export function one(args: ParsedArgs, name: string): string | undefined {
  return args.flags.get(name)?.at(-1)
}

export function many(args: ParsedArgs, name: string): string[] {
  return args.flags.get(name) ?? []
}

export function integer(args: ParsedArgs, name: string): number | undefined {
  const value = one(args, name)
  if (value === undefined) return undefined
  const number = Number(value)
  if (!Number.isSafeInteger(number) || number < 1) throw new Error(`--${name} must be a positive integer`)
  return number
}

export function shellWords(input: string): string[] {
  const words: string[] = []
  let current = ''
  let quote: '"' | "'" | undefined
  let escaping = false
  for (const char of input.trim()) {
    if (escaping) {
      current += char
      escaping = false
    } else if (char === '\\' && quote !== "'") {
      escaping = true
    } else if (quote !== undefined) {
      if (char === quote) quote = undefined
      else current += char
    } else if (char === '"' || char === "'") {
      quote = char
    } else if (/\s/u.test(char)) {
      if (current !== '') { words.push(current); current = '' }
    } else current += char
  }
  if (quote !== undefined) throw new Error('unterminated quote')
  if (escaping) current += '\\'
  if (current !== '') words.push(current)
  return words
}
