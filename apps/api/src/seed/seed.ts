import { NestFactory } from '@nestjs/core';
import { AppModule } from '../app.module';
import { PasswordService } from '../auth/password.service';
import { ConversationsService } from '../conversations/conversations.service';
import { MessagesService } from '../messages/messages.service';
import { UsersService } from '../users/users.service';

/** Every demo user signs in with this password. */
const PASSWORD = 'demo-password-1';

const USERS = ['alice', 'bob', 'carol', 'dave', 'erin'].map((username) => ({
  username,
  email: `${username}@example.com`,
}));

/** Who writes first in each demo conversation, then who answers: [from, to, text]. */
const CHATS: Array<[string, string, string[]]> = [
  ['alice', 'bob', ['Hi Bob!', 'Are we still on for lunch?']],
  ['carol', 'alice', ['Did you see the new build?', 'It looks great.']],
  ['dave', 'alice', ['Ping']],
];

/**
 * Demo data: a handful of users and a few conversations with unread messages. Safe to run
 * again: users that already exist are left alone, and a conversation that already has messages
 * is not filled twice. Run after the build: `node dist/seed/seed.js`.
 */
async function seed() {
  const app = await NestFactory.createApplicationContext(AppModule, { logger: ['error', 'warn'] });
  try {
    const users = app.get(UsersService);
    const conversations = app.get(ConversationsService);
    const messages = app.get(MessagesService);
    const passwordHash = await new PasswordService().hash(PASSWORD);

    const ids = new Map<string, string>();
    for (const { username, email } of USERS) {
      const existing = await users.findByEmailWithPassword(email);
      if (existing) {
        ids.set(username, existing._id.toString());
        console.log(`exists   ${email}`);
        continue;
      }
      const created = await users.create({ email, username, passwordHash });
      ids.set(username, created._id.toString());
      console.log(`created  ${email}`);
    }

    const id = (username: string) => ids.get(username) as string;
    for (const [from, to, texts] of CHATS) {
      const { conversation, created } = await conversations.open(id(from), id(to));
      if (!created && conversation.lastMessage) {
        continue;
      }
      for (const [index, text] of texts.entries()) {
        await messages.send(conversation.id, id(from), {
          text,
          clientMessageId: `seed-${from}-${to}-${index}`,
        });
      }
      console.log(`chat     ${from} -> ${to} (${texts.length})`);
    }

    console.log(`\nSign in with any of the emails above, password: ${PASSWORD}`);
  } finally {
    await app.close();
  }
}

void seed().catch((error: unknown) => {
  console.error(error);
  process.exit(1);
});
