import { generateRandomString } from './crypto'
import { prisma } from './prisma'

// Ported from the former AuthService#generateResetPasswordToken: creates a
// fresh reset-password token for the user, expiring any of their previous
// still-valid tokens so only the newest one works.
export async function generateResetPasswordToken(email: string) {
  let token = ''

  do
    token = generateRandomString(32)
  while (await prisma.resetPasswordToken.findFirst({ where: { token } }))

  const expiresAt = new Date()
  expiresAt.setMinutes(expiresAt.getMinutes() + 5)

  const resetPasswordToken = await prisma.resetPasswordToken.create({
    data: {
      token,
      expiresAt,
      user: { connect: { email } },
    },
  })

  await prisma.resetPasswordToken.updateMany({
    where: {
      user: { email },
      NOT: { id: resetPasswordToken.id },
    },
    data: { expired: true },
  })

  return token
}
