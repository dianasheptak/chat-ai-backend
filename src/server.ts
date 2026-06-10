import express, { Request, Response } from "express";
import cors from "cors";
import dotenv from "dotenv";
import { StreamChat } from "stream-chat";
import OpenAI from "openai";
import { db } from "./config/database.js";
import { chats, users, conversations } from "./db/schema.js";
import { and, desc, eq } from "drizzle-orm";
import { ChatCompletionMessageParam } from "openai/resources";

dotenv.config();

const app = express();

app.use(cors());
app.use(express.json());
app.use(express.urlencoded({extended: false}));

// init the stream chat

const chatClient = StreamChat.getInstance(
    process.env.STREAM_API_KEY!, 
    process.env.STREAM_SECRET_KEY!
)

// init OPEN AI 

const openai = new OpenAI({
    apiKey: process.env.OPENAI_API_KEY!
})


app.post('/register-user', async (req: Request, res: Response): Promise<any> => {
    const { name, email } = req.body ?? {};

    console.log('Content-Type:', req.headers['content-type'])
    console.log('req.body:', req.body)

    if (!name || !email) {
        return res.status(400).json({ error: 'Name and email are required!' })
    }

    try {
        const userId = email.replace(/[^a-zA-Z0-9_-]/g, '_')

        const userResponse = await chatClient.queryUsers({id: { $eq: userId}})

        if (!userResponse.users.length) {
            await chatClient.upsertUser({
            id: userId,
            name: name,
            email: email,
            role: 'user'
        } as any)
        }

        // check existing user in db
        const existingUser = await db
        .select()
        .from(users)
        .where(eq(users.userId, userId))

        if (!existingUser.length) {
            console.log('user', userId + ' doesnt exist in db')
            await db.insert(users).values({userId, name, email})
        }


        res.status(200).json({userId, name, email})
    }
    catch (e) {
        res.status(500).json({error: 'Internal server error..'})
    }
})

// send message to open ai
app.post('/chat', async(req: Request, res: Response): Promise<any> => {
    const { message, userId, conversationId } = req.body;

    if (!message || !userId) {
        return res.status(400).json({message: 'User is required!'})
    }

    try {
        const userResponse = await chatClient.queryUsers({id: {$eq: userId}})

        if (!userResponse.users.length) {
            return res.status(404).json({error: 'User not found!'})
        }

        // check user in db
        const existingUser = await db
            .select()
            .from(users)
            .where(eq(users.userId, userId))

        if (!existingUser.length) {
            return res.status(404).json({error: 'User not found in database, please register first!'})
        }

        // resolve the conversation (create a new one for the sidebar if none was passed)
        let conversation_id: number;

        if (conversationId) {
            const existingConversation = await db
                .select()
                .from(conversations)
                .where(and(eq(conversations.id, Number(conversationId)), eq(conversations.userId, userId)))

            if (!existingConversation.length) {
                return res.status(404).json({error: 'Conversation not found!'})
            }
            conversation_id = existingConversation[0].id
        } else {
            // title the new chat from the first user message
            const title = message.length > 40 ? `${message.slice(0, 40)}...` : message
            const [newConversation] = await db
                .insert(conversations)
                .values({ userId, title })
                .returning()
            conversation_id = newConversation.id
        }

        // fetch context for THIS conversation only
        const chatHistory = await db
            .select()
            .from(chats)
            .where(eq(chats.conversationId, conversation_id))
            .orderBy(chats.createdAt)
            .limit(15)



        const aiConversation: ChatCompletionMessageParam[] = chatHistory.flatMap((chat) => [
            {
                role: 'user',
                content: chat.message
            },
             {
                role: 'assistant',
                content: chat.reply
            },
        ])

        // add latest user messages to conversation

        aiConversation.push({ role: 'user', content: message });

        const response = await openai.chat.completions.create({
            model: 'gpt-4',
            messages: aiConversation as ChatCompletionMessageParam[]
        })

        const aiMessage: string = response.choices[0].message?.content ?? 'No response from AI';

        // store chat in db
        await db.insert(chats).values({userId, conversationId: conversation_id, message, reply: aiMessage})

        // bump conversation so it moves to the top of the sidebar
        await db
            .update(conversations)
            .set({ updatedAt: new Date() })
            .where(eq(conversations.id, conversation_id))

        // create channel

        const channel = chatClient.channel('messaging', `chat-${conversation_id}`, {
            name: 'AI Chat',
            created_by_id: 'ai_bit'
        } as any)

        await channel.create();
        await channel.sendMessage({text: aiMessage, user_id: 'ai_bot'})



        res.status(200).json({reply: aiMessage, conversationId: conversation_id})
    }
    catch {
        return res.status(500).json({error: 'Internal Server Error!'})
    }
})


// chat history for one conversation
app.post('/get-messages', async(req: Request, res: Response): Promise<any> => {
    const { userId, conversationId } = req.body;

    if (!userId || !conversationId) {
        return res.status(400).json({error: 'userId and conversationId are required'})
    }

    try {
        const chatHistory = await db
            .select()
            .from(chats)
            .where(and(eq(chats.userId, userId), eq(chats.conversationId, Number(conversationId))))
            .orderBy(chats.createdAt)

        res.status(200).json({messages: chatHistory})

    } catch (e) {
        console.log('Error fetching chat history...', e)
        res.status(500).json({error: 'Inernal Server Error'})
    }
})


// --- SIDEBAR: conversations ---

// list all conversations for a user (newest activity first)
app.get('/conversations/:userId', async(req: Request, res: Response): Promise<any> => {
    const userId = String(req.params.userId);

    if (!userId) {
        return res.status(400).json({error: 'userId is required'})
    }

    try {
        const result = await db
            .select()
            .from(conversations)
            .where(eq(conversations.userId, userId))
            .orderBy(desc(conversations.updatedAt))

        res.status(200).json({conversations: result})
    } catch (e) {
        console.log('Error fetching conversations...', e)
        res.status(500).json({error: 'Internal Server Error'})
    }
})

// create an empty conversation (e.g. "New chat" button)
app.post('/conversations', async(req: Request, res: Response): Promise<any> => {
    const { userId, title } = req.body;

    if (!userId) {
        return res.status(400).json({error: 'userId is required'})
    }

    try {
        const [conversation] = await db
            .insert(conversations)
            .values({ userId, title: title || 'New Chat' })
            .returning()

        res.status(201).json({conversation})
    } catch (e) {
        console.log('Error creating conversation...', e)
        res.status(500).json({error: 'Internal Server Error'})
    }
})

// rename a conversation (edit title in the sidebar)
app.patch('/conversations/:id', async(req: Request, res: Response): Promise<any> => {
    const { id } = req.params;
    const { userId, title } = req.body;

    if (!userId || !title) {
        return res.status(400).json({error: 'userId and title are required'})
    }

    try {
        const [conversation] = await db
            .update(conversations)
            .set({ title, updatedAt: new Date() })
            .where(and(eq(conversations.id, Number(id)), eq(conversations.userId, userId)))
            .returning()

        if (!conversation) {
            return res.status(404).json({error: 'Conversation not found!'})
        }

        res.status(200).json({conversation})
    } catch (e) {
        console.log('Error updating conversation...', e)
        res.status(500).json({error: 'Internal Server Error'})
    }
})

// delete a conversation (and its messages) from the sidebar
app.delete('/conversations/:id', async(req: Request, res: Response): Promise<any> => {
    const { id } = req.params;
    const { userId } = req.body;

    if (!userId) {
        return res.status(400).json({error: 'userId is required'})
    }

    try {
        // remove messages first (also covered by the FK cascade)
        await db.delete(chats).where(eq(chats.conversationId, Number(id)))

        const [deleted] = await db
            .delete(conversations)
            .where(and(eq(conversations.id, Number(id)), eq(conversations.userId, userId)))
            .returning()

        if (!deleted) {
            return res.status(404).json({error: 'Conversation not found!'})
        }

        // clean up the matching stream channel
        try {
            const channel = chatClient.channel('messaging', `chat-${id}`)
            await channel.delete()
        } catch (e) {
            console.log('Stream channel already gone or never created')
        }

        res.status(200).json({success: true})
    } catch (e) {
        console.log('Error deleting conversation...', e)
        res.status(500).json({error: 'Internal Server Error'})
    }
})


const PORT = process.env.PORT || 5000;

app.listen(PORT, () => console.log('Server running ....'))