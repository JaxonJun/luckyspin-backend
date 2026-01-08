require('dotenv').config();
const express = require('express');
const mongoose = require('mongoose');
const cors = require('cors');

const app = express();
const PORT = process.env.PORT || 3001;

// Middleware
app.use(cors());
app.use(express.json());

// MongoDB Connection
mongoose.connect(process.env.MONGODB_URI)
    .then(() => console.log('✅ Connected to MongoDB'))
    .catch(err => console.error('❌ MongoDB Connection Error:', err));

// Schemas
const SpinSchema = new mongoose.Schema({
    username: { type: String, required: true },
    prize: String,
    date: { type: Date, default: Date.now },
    device: String,
    ipAddress: String,
    os: String
});

const ConfigSchema = new mongoose.Schema({
    prizes: {
        en: [String],
        mm: [String]
    },
    probabilities: [Number]
});

const CounterSchema = new mongoose.Schema({
    name: { type: String, default: 'main' },
    baseCounter: { type: Number, default: 1958 },
    totalSpins: Number // Optional: if you want to store the computed total
});

const Spin = mongoose.model('Spin', SpinSchema);
const Config = mongoose.model('Config', ConfigSchema);
const Counter = mongoose.model('Counter', CounterSchema);

// --- Public Routes ---

// Get all spins (or filter by date/username)
app.get('/api/spins', async (req, res) => {
    try {
        const { dateFilter, username } = req.query;
        let query = {};

        if (username) {
            query.username = { $regex: username, $options: 'i' };
        }

        if (dateFilter) {
            const start = new Date(dateFilter);
            start.setHours(0, 0, 0, 0);
            const end = new Date(dateFilter);
            end.setHours(23, 59, 59, 999);
            query.date = { $gte: start, $lte: end };
        }

        const spins = await Spin.find(query).sort({ date: -1 });
        res.json(spins);
    } catch (error) {
        res.status(500).json({ error: error.message });
    }
});

// Record a new spin
app.post('/api/spin', async (req, res) => {
    try {
        const { username, prize, device, ipAddress, os } = req.body;

        // Check if user already spun (optional strict check)
        const existing = await Spin.findOne({ username: { $regex: new RegExp(`^${username}$`, 'i') } });
        if (existing) {
            return res.status(400).json({ success: false, error: 'User already spun' });
        }

        const newSpin = new Spin({
            username,
            prize,
            device: device || 'Unknown',
            ipAddress: ipAddress || req.ip,
            os: os || 'Unknown'
        });

        await newSpin.save();
        res.json({ success: true, spin: newSpin });
    } catch (error) {
        res.status(500).json({ success: false, error: error.message });
    }
});

// Get Configuration (Prizes & Probabilities)
app.get('/api/config', async (req, res) => {
    try {
        let config = await Config.findOne();
        if (!config) {
            // Create default if not exists
            config = new Config({
                prizes: {
                    en: ["500 MMK", "1,000 MMK", "2,000 MMK", "3,000 MMK", "5,000 MMK", "10,000 MMK", "15,000 MMK", "30,000 MMK", "100,000 MMK"],
                    mm: ["၅၀၀ ကျပ်", "၁၀၀၀ ကျပ်", "၂၀၀၀ ကျပ်", "၃၀၀၀ ကျပ်", "၅၀၀၀ ကျပ်", "၁၀၀၀၀ ကျပ်", "၁၅၀၀၀ ကျပ်", "၃၀၀၀၀ ကျပ်", "၁၀၀၀၀၀ ကျပ်"]
                },
                probabilities: [30, 20, 40, 30, 1, 0.1, 0.01, 0.001, 0.0001]
            });
            await config.save();
        }
        res.json({ success: true, config });
    } catch (error) {
        res.status(500).json({ success: false, error: error.message });
    }
});

// Get Total Spins (Base + Database Count)
app.get('/api/total-spins', async (req, res) => {
    try {
        const dbCount = await Spin.countDocuments();
        let counter = await Counter.findOne({ name: 'main' });
        if (!counter) {
            counter = new Counter({ name: 'main', baseCounter: 1958 });
            await counter.save();
        }

        const totalSpins = (counter.baseCounter || 1958) + dbCount;
        res.json({ success: true, totalSpins, baseCounter: counter.baseCounter, dbSpins: dbCount });
    } catch (error) {
        res.status(500).json({ success: false, error: error.message });
    }
});

// Winner Board
app.get('/api/winner-board', async (req, res) => {
    try {
        // Example: Return latest 10 winners
        const winners = await Spin.find().sort({ date: -1 }).limit(10);
        // Format for frontend if needed
        const formattedWinners = winners.map((w, i) => ({
            idx: i + 1,
            en: w.username.substring(0, 3) + '****',
            mm: w.username.substring(0, 3) + '****',
            prize: w.prize
        }));

        res.json({ success: true, winners: formattedWinners, mode: 'real' });
    } catch (error) {
        res.status(500).json({ success: false, error: error.message });
    }
});

// Test Connection
app.get('/api/test', async (req, res) => {
    try {
        const spinCount = await Spin.countDocuments();
        res.json({
            success: true,
            message: 'Backend is working!',
            database: mongoose.connection.name,
            spinCount
        });
    } catch (error) {
        res.status(500).json({ success: false, error: error.message });
    }
});

// --- Admin Routes ---

// Get Stats
app.get('/api/admin/stats', async (req, res) => {
    try {
        const { dateFilter } = req.query;
        let query = {};
        if (dateFilter) {
            const start = new Date(dateFilter);
            start.setHours(0, 0, 0, 0);
            const end = new Date(dateFilter);
            end.setHours(23, 59, 59, 999);
            query.date = { $gte: start, $lte: end };
        }

        const spins = await Spin.find(query);
        const totalPrizesCode = spins.reduce((sum, s) => {
            // Extract number from prize string (e.g. "1,000 MMK" -> 1000)
            const amount = parseInt(s.prize.replace(/[^0-9]/g, '')) || 0;
            return sum + amount;
        }, 0);

        const todayStart = new Date();
        todayStart.setHours(0, 0, 0, 0);
        const todaySpins = await Spin.countDocuments({ date: { $gte: todayStart } });

        res.json({
            success: true,
            stats: {
                totalUsers: spins.length,
                totalSpins: spins.length,
                totalPrizes: totalPrizesCode,
                todaySpins,
                dateLabel: dateFilter || 'All Time'
            }
        });

    } catch (error) {
        res.status(500).json({ success: false, error: error.message });
    }
});

// Delete User
app.post('/api/admin/delete-user', async (req, res) => {
    try {
        const { username } = req.body;
        await Spin.deleteMany({ username });
        res.json({ success: true });
    } catch (error) {
        res.status(500).json({ success: false, error: error.message });
    }
});

// Batch Delete
app.post('/api/admin/batch-delete', async (req, res) => {
    try {
        const { usernames } = req.body;
        const result = await Spin.deleteMany({ username: { $in: usernames } });
        res.json({ success: true, deletedCount: result.deletedCount });
    } catch (error) {
        res.status(500).json({ success: false, error: error.message });
    }
});

// Update Probabilities
app.post('/api/admin/probabilities', async (req, res) => {
    try {
        const { probabilities } = req.body;
        let config = await Config.findOne();
        if (!config) { config = new Config(); }
        config.probabilities = probabilities;
        await config.save();
        res.json({ success: true });
    } catch (error) {
        res.status(500).json({ success: false, error: error.message });
    }
});

// Update Prizes
app.post('/api/admin/prizes', async (req, res) => {
    try {
        const { prizes } = req.body;
        let config = await Config.findOne();
        if (!config) { config = new Config(); }
        config.prizes = prizes;
        await config.save();
        res.json({ success: true });
    } catch (error) {
        res.status(500).json({ success: false, error: error.message });
    }
});

// Update Base Counter
app.post('/api/admin/counter/set-base', async (req, res) => {
    try {
        const { base } = req.body;
        let counter = await Counter.findOne({ name: 'main' });
        if (!counter) { counter = new Counter({ name: 'main' }); }
        counter.baseCounter = base;
        await counter.save();
        res.json({ success: true, counter });
    } catch (error) {
        res.status(500).json({ success: false, error: error.message });
    }
});

app.listen(PORT, () => {
    console.log(`Server running on port ${PORT}`);
});
