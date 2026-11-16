/**
 * Cria (ou troca a senha de) um usuário do painel.
 *   npm run create-admin -- voce@exemplo.com "Seu Nome"
 * A senha é pedida no terminal, sem eco, e nunca vai para o histórico do shell.
 */
import argon2 from 'argon2'
import { createInterface } from 'node:readline'
import { prisma } from '../lib/prisma.js'

const [email, ...nameParts] = process.argv.slice(2)
if (!email || !email.includes('@')) {
  console.error('Uso: npm run create-admin -- email@dominio "Nome"')
  process.exit(1)
}
const name = nameParts.join(' ') || email.split('@')[0]!

async function askHidden(prompt: string): Promise<string> {
  if (process.env.ADMIN_PASSWORD) return process.env.ADMIN_PASSWORD
  const rl = createInterface({ input: process.stdin, output: process.stdout, terminal: true })
  const out = rl as unknown as { _writeToOutput: (s: string) => void; output: NodeJS.WriteStream }
  let muted = false
  out._writeToOutput = (s: string) => {
    if (!muted) out.output.write(s)
  }
  return new Promise((resolve) => {
    rl.question(prompt, (answer) => {
      rl.close()
      process.stdout.write('\n')
      resolve(answer)
    })
    muted = true
  })
}

const password = await askHidden('Senha (mín. 12 caracteres): ')
if (password.length < 12) {
  console.error('A senha precisa de ao menos 12 caracteres.')
  process.exit(1)
}
const passwordHash = await argon2.hash(password, { type: argon2.argon2id })
const user = await prisma.adminUser.upsert({
  where: { email: email.toLowerCase() },
  create: { email: email.toLowerCase(), name, passwordHash },
  update: { passwordHash },
})
await prisma.adminSession.deleteMany({ where: { userId: user.id } })
console.log(`Pronto: ${user.email}. Entre em /painel.`)
await prisma.$disconnect()
