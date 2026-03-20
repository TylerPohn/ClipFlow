import { PrismaAdapter } from '@auth/prisma-adapter';
import type { NextAuthOptions } from 'next-auth';
import { getServerSession as nextAuthGetServerSession } from 'next-auth';
import GitHubProvider from 'next-auth/providers/github';
import { prisma } from '@clipflow/db';

export const authOptions: NextAuthOptions = {
  adapter: PrismaAdapter(prisma) as NextAuthOptions['adapter'],
  providers: [
    GitHubProvider({
      clientId: process.env.GITHUB_ID ?? '',
      clientSecret: process.env.GITHUB_SECRET ?? '',
    }),
    // TikTok is linked via custom /api/auth/tiktok/link flow, not NextAuth signIn
  ],
  session: {
    strategy: 'jwt',
  },
  callbacks: {
    async jwt({ token, user }) {
      if (user) {
        token.userId = user.id;
      }
      return token;
    },
    async session({ session, token }) {
      if (session.user && token.userId) {
        (session.user as { id?: string }).id = token.userId as string;
      }
      return session;
    },
  },
};

export function getServerSession() {
  return nextAuthGetServerSession(authOptions);
}
