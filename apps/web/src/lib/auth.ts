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
    {
      id: 'tiktok',
      name: 'TikTok',
      type: 'oauth',
      clientId: process.env.TIKTOK_CLIENT_KEY,
      clientSecret: process.env.TIKTOK_CLIENT_SECRET,
      authorization: {
        url: 'https://www.tiktok.com/v2/auth/authorize/',
        params: {
          scope: 'user.info.basic,video.publish',
          response_type: 'code',
        },
      },
      token: 'https://open.tiktokapis.com/v2/oauth/token/',
      userinfo: 'https://open.tiktokapis.com/v2/user/info/',
      profile(profile) {
        return {
          id: profile.data?.user?.open_id ?? profile.open_id ?? profile.id,
          name: profile.data?.user?.display_name ?? profile.display_name ?? profile.name,
          email: profile.data?.user?.email ?? profile.email ?? null,
          image: profile.data?.user?.avatar_url ?? profile.avatar_url ?? null,
        };
      },
    },
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
