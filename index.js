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
    probabilities: [Number],
    winnerBoardMode: { type: String, default: 'real' } // 'real' or 'demo'
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
            // Expand range by ±1 day to handle timezone offsets (e.g. Myanmar UTC+6:30)
            const start = new Date(dateFilter + 'T00:00:00.000Z');
            start.setDate(start.getDate() - 1);
            const end = new Date(dateFilter + 'T23:59:59.999Z');
            end.setDate(end.getDate() + 1);
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

        // Reject if prize is missing or undefined
        if (!prize || prize === 'undefined') {
            return res.status(400).json({ success: false, error: 'Invalid prize value' });
        }

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
        const defaultPrizes = {
            en: ["500 MMK", "1,000 MMK", "2,000 MMK", "3,000 MMK", "5,000 MMK", "10,000 MMK", "15,000 MMK", "30,000 MMK", "100,000 MMK"],
            mm: ["\u1045\u1040\u1040 \u1000\u103b\u1015\u103a", "\u1041\u1040\u1040\u1040 \u1000\u103b\u1015\u103a", "\u1042\u1040\u1040\u1040 \u1000\u103b\u1015\u103a", "\u1043\u1040\u1040\u1040 \u1000\u103b\u1015\u103a", "\u1045\u1040\u1040\u1040 \u1000\u103b\u1015\u103a", "\u1041\u1040\u1040\u1040\u1040 \u1000\u103b\u1015\u103a", "\u1041\u1045\u1040\u1040\u1040 \u1000\u103b\u1015\u103a", "\u1043\u1040\u1040\u1040\u1040 \u1000\u103b\u1015\u103a", "\u1041\u1040\u1040\u1040\u1040\u1040 \u1000\u103b\u1015\u103a"]
        };
        const defaultProbs = [30, 20, 40, 30, 1, 0.1, 0.01, 0.001, 0.0001];

        if (!config) {
            config = new Config({ prizes: defaultPrizes, probabilities: defaultProbs, winnerBoardMode: 'real' });
            await config.save();
        }

        // Auto-fix if prizes are missing or corrupted (wrong length)
        const enOk = config.prizes && config.prizes.en && config.prizes.en.length === 9;
        const mmOk = config.prizes && config.prizes.mm && config.prizes.mm.length === 9;
        const probsOk = config.probabilities && config.probabilities.length === 9;
        if (!enOk || !mmOk || !probsOk) {
            config.prizes = defaultPrizes;
            config.probabilities = defaultProbs;
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

// Cleanup: remove spins with undefined/missing prize
app.delete('/api/admin/cleanup-invalid', async (req, res) => {
    try {
        const result = await Spin.deleteMany({ $or: [{ prize: null }, { prize: 'undefined' }, { prize: '' }] });
        res.json({ success: true, deletedCount: result.deletedCount });
    } catch (error) {
        res.status(500).json({ success: false, error: error.message });
    }
});

// Force reset config to defaults (fixes corrupted MongoDB config)
// GET version so you can trigger it directly from browser
app.get('/api/admin/reset-config', async (req, res) => {
    try {
        await Config.deleteMany({});
        const config = new Config({
            prizes: {
                en: ["500 MMK", "1,000 MMK", "2,000 MMK", "3,000 MMK", "5,000 MMK", "10,000 MMK", "15,000 MMK", "30,000 MMK", "100,000 MMK"],
                mm: ["\u1045\u1040\u1040 \u1000\u103b\u1015\u103a", "\u1041\u1040\u1040\u1040 \u1000\u103b\u1015\u103a", "\u1042\u1040\u1040\u1040 \u1000\u103b\u1015\u103a", "\u1043\u1040\u1040\u1040 \u1000\u103b\u1015\u103a", "\u1045\u1040\u1040\u1040 \u1000\u103b\u1015\u103a", "\u1041\u1040\u1040\u1040\u1040 \u1000\u103b\u1015\u103a", "\u1041\u1045\u1040\u1040\u1040 \u1000\u103b\u1015\u103a", "\u1043\u1040\u1040\u1040\u1040 \u1000\u103b\u1015\u103a", "\u1041\u1040\u1040\u1040\u1040\u1040 \u1000\u103b\u1015\u103a"]
            },
            probabilities: [30, 20, 40, 30, 1, 0.1, 0.01, 0.001, 0.0001],
            winnerBoardMode: 'real'
        });
        await config.save();
        res.json({ success: true, message: 'Config reset to defaults', config });
    } catch (error) {
        res.status(500).json({ success: false, error: error.message });
    }
});

app.post('/api/admin/reset-config', async (req, res) => {
    try {
        await Config.deleteMany({});
        const config = new Config({
            prizes: {
                en: ["500 MMK", "1,000 MMK", "2,000 MMK", "3,000 MMK", "5,000 MMK", "10,000 MMK", "15,000 MMK", "30,000 MMK", "100,000 MMK"],
                mm: ["\u1045\u1040\u1040 \u1000\u103b\u1015\u103a", "\u1041\u1040\u1040\u1040 \u1000\u103b\u1015\u103a", "\u1042\u1040\u1040\u1040 \u1000\u103b\u1015\u103a", "\u1043\u1040\u1040\u1040 \u1000\u103b\u1015\u103a", "\u1045\u1040\u1040\u1040 \u1000\u103b\u1015\u103a", "\u1041\u1040\u1040\u1040\u1040 \u1000\u103b\u1015\u103a", "\u1041\u1045\u1040\u1040\u1040 \u1000\u103b\u1015\u103a", "\u1043\u1040\u1040\u1040\u1040 \u1000\u103b\u1015\u103a", "\u1041\u1040\u1040\u1040\u1040\u1040 \u1000\u103b\u1015\u103a"]
            },
            probabilities: [30, 20, 40, 30, 1, 0.1, 0.01, 0.001, 0.0001],
            winnerBoardMode: 'real'
        });
        await config.save();
        res.json({ success: true, message: 'Config reset to defaults', config });
    } catch (error) {
        res.status(500).json({ success: false, error: error.message });
    }
});

// Cleanup invalid spins — GET version for browser access
app.get('/api/admin/cleanup-invalid', async (req, res) => {
    try {
        const result = await Spin.deleteMany({ $or: [{ prize: null }, { prize: 'undefined' }, { prize: '' }] });
        res.json({ success: true, deletedCount: result.deletedCount });
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
            if (!s.prize) return sum;
            const amount = parseInt(s.prize.toString().replace(/[^0-9]/g, '')) || 0;
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

// Update Winner Board Mode
app.post('/api/admin/mode', async (req, res) => {
    try {
        const { mode } = req.body; // 'real' or 'demo'
        let config = await Config.findOne();
        if (!config) { config = new Config(); }
        config.winnerBoardMode = mode;
        await config.save();
        res.json({ success: true, mode: config.winnerBoardMode });
    } catch (error) {
        res.status(500).json({ success: false, error: error.message });
    }
});

// --- Missing GET Routes for Admin Panel ---

// Get Prizes (Admin)
app.get('/api/admin/prizes', async (req, res) => {
    try {
        let config = await Config.findOne();
        if (!config) {
            // Return defaults if no config exists
            return res.json({
                success: true,
                prizes: {
                    en: ["500 MMK", "1,000 MMK", "2,000 MMK", "3,000 MMK", "5,000 MMK", "10,000 MMK", "15,000 MMK", "30,000 MMK", "100,000 MMK"],
                    mm: ["၅၀၀ ကျပ်", "၁၀၀၀ ကျပ်", "၂၀၀၀ ကျပ်", "၃၀၀၀ ကျပ်", "၅၀၀၀ ကျပ်", "၁၀၀၀၀ ကျပ်", "၁၅၀၀၀ ကျပ်", "၃၀၀၀၀ ကျပ်", "၁၀၀၀၀၀ ကျပ်"]
                }
            });
        }
        res.json({ success: true, prizes: config.prizes });
    } catch (error) {
        res.status(500).json({ success: false, error: error.message });
    }
});

// Get Probabilities (Admin)
app.get('/api/admin/probabilities', async (req, res) => {
    try {
        let config = await Config.findOne();
        // Default probabilities if null
        const defaultProbs = [30, 20, 40, 30, 1, 0.1, 0.01, 0.001, 0.0001];

        if (!config) {
            return res.json({ success: true, probabilities: defaultProbs });
        }
        res.json({ success: true, probabilities: config.probabilities || defaultProbs });
    } catch (error) {
        res.status(500).json({ success: false, error: error.message });
    }
});

// Get Counter (Admin)
app.get('/api/admin/counter', async (req, res) => {
    try {
        let counter = await Counter.findOne({ name: 'main' });
        const dbSpins = await Spin.countDocuments();

        // Default if not exists
        if (!counter) {
            counter = { baseCounter: 1958 };
        }

        const displayedTotal = (counter.baseCounter || 1958) + dbSpins;

        res.json({
            success: true,
            counter: {
                displayedTotal,
                baseCounter: counter.baseCounter || 1958,
                dbSpins
            }
        });
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
