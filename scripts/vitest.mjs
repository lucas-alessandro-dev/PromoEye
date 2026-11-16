/**
 * Roda o Vitest com a pasta de trabalho normalizada.
 *
 * No Windows, quando a pasta chega como "c:\..." (drive minúsculo — é como o
 * VS Code abre o projeto), o Vitest carrega o próprio módulo duas vezes e
 * todo teste falha com "Vitest failed to find the current suite". Com "C:\"
 * maiúsculo funciona. Este script só faz essa troca e repassa os argumentos.
 */
import { spawnSync } from 'node:child_process'
import { createRequire } from 'node:module'
import { dirname, join } from 'node:path'

const upperDrive = (p) => p.replace(/^[a-z]:/, (d) => d.toUpperCase())
const require = createRequire(import.meta.url)
const cwd = upperDrive(process.cwd())
// O binário também: se ele vier de "c:\" e os testes importarem de "C:\",
// são dois módulos diferentes de novo.
const bin = upperDrive(join(dirname(require.resolve('vitest/package.json')), 'vitest.mjs'))
const res = spawnSync(process.execPath, [bin, ...process.argv.slice(2)], { cwd, stdio: 'inherit' })
process.exit(res.status ?? 1)
