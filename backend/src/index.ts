import express from 'express';
import cors from 'cors';
import dotenv from 'dotenv';
import { storyRouter } from './routes/story';

dotenv.config();

const app = express();
const PORT = process.env.PORT ?? 3001;

app.use(cors());
app.use(express.json());

app.get('/health', (_req, res) => {
  res.json({ status: 'ok', service: 'mythos-writer-backend' });
});

app.use('/api/stories', storyRouter);

app.listen(PORT, () => {
  console.log(`Backend listening on http://localhost:${PORT}`);
});

export { app };
