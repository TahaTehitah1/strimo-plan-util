import express, { Request, Response } from 'express';
import cors from 'cors';
import dotenv from 'dotenv';
import { purchasePlan } from './purchase';

dotenv.config();

const app = express();
const PORT = process.env.PORT || 3000;

// CORS Configuration
const allowedOrigins = process.env.ALLOWED_ORIGINS ? process.env.ALLOWED_ORIGINS.split(',') : [];

const corsOptions = {
  origin: (origin: string | undefined, callback: Function) => {
    // Allow requests with no origin (like mobile apps or curl requests)
    if (!origin) return callback(null, true);

    if (allowedOrigins.indexOf(origin) !== -1) {
      callback(null, true);
    } else {
      callback(new Error('Not allowed by CORS'));
    }
  },
  credentials: false, // Set to true if you need to support cookies/credentials
};

app.use(cors(corsOptions));
app.use(express.json());

// API Key Authentication Middleware
const authenticateApiKey = (req: Request, res: Response, next: any) => {
  const apiKey = req.headers['x-api-key'];
  const validApiKey = process.env.API_KEY;

  if (!validApiKey) {
    return res.status(500).json({ error: 'API key not configured' });
  }

  if (!apiKey || apiKey !== validApiKey) {
    return res.status(401).json({ error: 'Unauthorized: Invalid API key' });
  }

  next();
};

// Purchase Plan Route (POST /purchase-plan)
app.post('/purchase-plan', authenticateApiKey, async (req: Request, res: Response) => {
  try {
    const { planId, email, orderType = 'STANDARD', macAddress, isFreeTrial = false } = req.body;

    // Basic validation
    if (!planId || !email) {
      return res.status(400).json({ error: 'planId and email are required' });
    }

    // Call the purchasePlan function
    const result = await purchasePlan(planId, email, orderType, macAddress, isFreeTrial);

    res.json(result);
  } catch (error) {
    console.error('API Error:', error);
    res.status(500).json({
      username: '',
      password: '',
      success: false,
      error: error instanceof Error ? error.message : 'Internal server error'
    });
  }
});

// Health check endpoint (optional, no auth required)
app.get('/health', (req: Request, res: Response) => {
  res.json({ status: 'OK' });
});

app.listen(PORT, () => {
  console.log(`Server running on port ${PORT}`);
});

export default app;
