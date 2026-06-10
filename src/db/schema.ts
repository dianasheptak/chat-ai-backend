import { pgTable, serial, text, timestamp, integer } from "drizzle-orm/pg-core";

// a conversation = one chat shown in the sidebar
export const conversations = pgTable('conversations', {
  id: serial('id').primaryKey(),
  userId: text('user_id').notNull(),
  title: text('title').notNull().default('New Chat'),
  createdAt: timestamp('created_at').defaultNow().notNull(),
  updatedAt: timestamp('updated_at').defaultNow().notNull(),
});

export const chats = pgTable('chats', {
  id: serial('id').primaryKey(),
  userId: text('user_id').notNull(),
  conversationId: integer('conversation_id').references(() => conversations.id, { onDelete: 'cascade' }),
  message: text('message').notNull(),
  reply: text('reply').notNull(),
  createdAt: timestamp('created_at').defaultNow().notNull(),
});

export const users = pgTable('users', {
  userId: text('user_id').primaryKey(),
  name: text('name').notNull(),
  email: text('email').notNull(),
  createdAt: timestamp('created_at').defaultNow().notNull(),
});

// type inference for drizzle queries
export type ChatInsert = typeof chats.$inferInsert;
export type ChatSelect = typeof chats.$inferSelect;
export type UserInsert = typeof users.$inferInsert;
export type UserSelect = typeof users.$inferSelect;
export type ConversationInsert = typeof conversations.$inferInsert;
export type ConversationSelect = typeof conversations.$inferSelect;