// Basic Express server for Lucky Spin
const express = require('express');
const mongoose = require('mongoose');
const cors = require('cors');
require('dotenv').config();

const app = express();
const PORT = process.env.PORT || 3001;

app.use(cors());
app.use(express.json());

// MongoDB connection
mongoose.connect(process.env.MONGODB_URI, {
  useNewUrlParser: true,
  useUnifiedTopology: true,
});

// Define schema for spins
const spinSchema = new mongoose.Schema({
  username: { type: String, required: true },
  prize: { type: String, required: true },
  date: { type: Date, default: Date.now },
});

const Spin = mongoose.model('Spin', spinSchema);

// Save a spin result
app.post('/api/spin', async (req, res) => {
  try {
    let { username, prize } = req.body;
    username = username.trim().toLowerCase();
    const spin = new Spin({ username, prize });
    await spin.save();
    res.status(201).json({ success: true, spin });
  } catch (err) {
    res.status(500).json({ success: false, error: err.message });
  }
});

// Get all spins (winner history)
app.get('/api/spins', async (req, res) => {
  try {
    const spins = await Spin.find().sort({ date: -1 }).limit(100);
    res.json(spins);
  } catch (err) {
    res.status(500).json({ success: false, error: err.message });
  }
});

// Delete all spins (admin only)
app.delete('/api/spins', async (req, res) => {
  try {
    await Spin.deleteMany({});
    res.json({ success: true });
  } catch (err) {
    res.status(500).json({ success: false, error: err.message });
  }
});

// Delete spins by username (admin only)
app.delete('/api/spins/user/:username', async (req, res) => {
  try {
    let username = req.params.username;
    if (!username) {
      return res.status(400).json({ success: false, error: 'Username is required.' });
    }
    username = username.trim().toLowerCase();
    // Match username exactly, case-insensitive, and ignore whitespace
    const result = await Spin.deleteMany({ username: username });
    res.json({ success: true, deletedCount: result.deletedCount });
  } catch (err) {
    res.status(500).json({ success: false, error: err.message });
  }
});

app.listen(PORT, () => {
  console.log(`Server running on port ${PORT}`);
});
