import express, { Request, Response } from "express";
import cors from "cors";
import dotenv from "dotenv";
import { StreamChat } from "stream-chat";
import OpenAI from "openai";

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
    const { name, email } = req.body;

    try {
        const userId = email.replace(/[^a-zA-Z0-9_-]/g, '-')

        const userResponse = await chatClient.queryUsers({id: { $eq: userId}})

        if (!userResponse.users.length) {
            await chatClient.upsertUser({
                id: userId,
                name: name,
                email: email,
                role: 'user'
            })
        }


        res.status(200).json({userId, name, email})
    }
    catch (e) {
        if (!name || !email) {
            return res.status(400).json({errror: 'Name and email are required!'})
        }
        res.status(500).json({error: 'Internal server error..'})
    }
})

// send message to open ai
app.post('/chat', async(req: Request, res: Response): Promise<any> => {
    const { message, userId} = req.body;

    if (!message || !userId) {
        return res.status(400).json({message: 'User is required!'})
    }

    try {
        const userResponse = await chatClient.queryUsers({id: {$eq: userId}})

        if (!userResponse.users.length) {
            return res.status(404).json({error: 'User not found!'})
        }

        res.status(200).json({message: 'success'})
    }
    catch {
            return res.status(500).json({error: 'Internal Server Error!'})
    }
})


const PORT = process.env.PORT || 5000;

app.listen(PORT, () => console.log('Server running ....'))