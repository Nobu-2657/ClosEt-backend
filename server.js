require('dotenv').config();
const express = require('express');
const mongoose = require('mongoose');
const bcrypt = require('bcrypt');
const jwt = require('jsonwebtoken');
const { randomUUID: uuidv4 } = require('crypto');
const cors = require('cors');
const bodyParser = require('body-parser');
const multer = require('multer');
const fetch = require('node-fetch');
const cloudinary = require('cloudinary').v2;
const { CloudinaryStorage } = require('multer-storage-cloudinary');

const app = express();

// --- 基本設定 ---
app.use(express.json({ limit: '50mb' }));
app.use(bodyParser.urlencoded({ limit: '50mb', extended: true }));
app.use(cors());

const JWT_SECRET = process.env.JWT_SECRET;
const PORT = process.env.PORT || 3000;

// --- MongoDB接続 ---
mongoose.connect(process.env.MONGODB_URI)
  .then(() => console.log('MongoDB Connected to Atlas!'))
  .catch(err => console.error('MongoDB Connection Error:', err));

// --- Cloudinary設定 ---
cloudinary.config({
  cloud_name: process.env.CLOUDINARY_CLOUD_NAME,
  api_key: process.env.CLOUDINARY_API_KEY,
  api_secret: process.env.CLOUDINARY_API_SECRET
});

const storage = new CloudinaryStorage({
  cloudinary: cloudinary,
  params: {
    folder: 'closet_uploads',
    allowed_formats: ['jpg', 'png', 'jpeg'],
  },
});
const upload = multer({ storage: storage });

// --- データモデル定義 ---
const User = mongoose.model('User', {
    userId: String,
    email: { type: String, unique: true },
    password: String,
    displayName: String
});

const imageSchema = new mongoose.Schema({
    imageUrl: { type: String, required: true },
    userId: { type: String, required: true },
    name: { type: String, required: true },
    category: { type: String, required: true },
    temperature: { type: Number, required: true },
    createdAt: { type: Date, default: Date.now }
});
const Image = mongoose.model('Image', imageSchema);

const DailyInfo = mongoose.model('DailyInfo', new mongoose.Schema({
    userId: { type: String, required: true },
    date: { type: Date, required: true },
    clothesIds: { type: [String], required: true }
}, { timestamps: true }));

const Feedback = mongoose.model('Feedback', new mongoose.Schema({
    userId: { type: String, required: true },
    feedback: { type: Number, required: true },
    date: { type: Date, required: true }
}));

// ==========================================
// 1. ユーザー認証 API (元 app.js)
// ==========================================

app.post('/api/check-email', async (req, res) => {
    try {
        const { email } = req.body;
        const existingUser = await User.findOne({ email });
        if (existingUser) return res.status(400).json({ message: 'このメールアドレスは既に登録されています' });
        return res.status(200).json({ message: 'このメールアドレスは使用可能です' });
    } catch (error) {
        res.status(500).json({ message: 'サーバーエラーが発生しました' });
    }
});

app.post('/api/register', async (req, res) => {
    try {
        const { email, password, displayName } = req.body;
        const existingUser = await User.findOne({ email });
        if (existingUser) return res.status(400).json({ message: '既に登録されています' });

        const hashedPassword = await bcrypt.hash(password, 10);
        const newUser = new User({
            userId: uuidv4(),
            email,
            password: hashedPassword,
            displayName
        });
        await newUser.save();

        const token = jwt.sign({ userId: newUser.userId }, JWT_SECRET, { expiresIn: '1h' });
        res.status(201).json({ message: '登録完了', user: { id: newUser.userId, email, displayName }, token });
    } catch (error) {
        res.status(500).json({ message: '登録エラー' });
    }
});

app.post('/api/login', async (req, res) => {
    try {
        const { email, password } = req.body;
        const user = await User.findOne({ email });
        if (!user || !(await bcrypt.compare(password, user.password))) {
            return res.status(401).json({ message: 'メールアドレスまたはパスワードが間違っています' });
        }
        const token = jwt.sign({ userId: user.userId }, JWT_SECRET, { expiresIn: '1h' });
        res.json({ message: 'ログイン成功', token, user: { id: user.userId, email: user.email, displayName: user.displayName } });
    } catch (error) {
        res.status(500).json({ message: 'ログインに失敗しました' });
    }
});

// ==========================================
// 2. 服・コーディネート管理 API (元 clothes.js)
// ==========================================

app.post('/api/upload', upload.single('image'), async (req, res) => {
    try {
        if (!req.file) return res.status(400).json({ message: 'No file uploaded' });
        const { userId, name, category, temperature } = req.body;
        const newImage = new Image({
            imageUrl: req.file.path, 
            userId, name, category,
            temperature: Number(temperature)
        });
        await newImage.save();
        res.status(200).json({ message: 'Upload successful', imageUrl: req.file.path, id: newImage._id });
    } catch (error) {
        res.status(500).json({ message: error.message });
    }
});

app.get('/api/images', async (req, res) => {
    try {
        const images = await Image.find({ userId: req.query.userId });
        res.json(images.map(img => ({
            id: img._id, imageUrl: img.imageUrl, name: img.name,
            category: img.category, temperature: img.temperature, createdAt: img.createdAt
        })));
    } catch (error) {
        res.status(500).json({ message: 'Error fetching images' });
    }
});

app.put('/api/update', async (req, res) => {
    const { id, userId, name, category, temperature } = req.body;
    try {
        const updated = await Image.findOneAndUpdate({ _id: id, userId }, { name, category, temperature }, { new: true });
        if (!updated) return res.status(404).json({ message: '見つかりません' });
        res.json(updated);
    } catch (error) {
        res.status(500).json({ message: '更新エラー' });
    }
});

app.delete('/api/delete', async (req, res) => {
    try {
        const { id, userId } = req.body;
        await Image.findOneAndDelete({ _id: id, userId });
        res.json({ message: '正常に削除されました' });
    } catch (error) {
        res.status(500).json({ message: '削除中にエラーが発生しました' });
    }
});

app.post('/api/register-outfit', async (req, res) => {
    try {
        const { userId, date, clothesIds } = req.body;
        const newDailyInfo = new DailyInfo({ userId, date, clothesIds });
        await newDailyInfo.save();
        res.status(201).json({ message: 'Success', dailyInfo: newDailyInfo });
    } catch (error) {
        res.status(500).json({ message: 'Failed to register outfit' });
    }
});

// ★省略せずに全て含めたフィードバック処理
app.post('/api/submit-feedback', async (req, res) => {
    try {
        const { userId, feedback, date } = req.body;
        const newFeedback = new Feedback({ userId, feedback, date });
        await newFeedback.save();

        const dailyInfo = await DailyInfo.findOne({
            userId,
            date: {
                $gte: new Date(new Date(date).setHours(0, 0, 0)),
                $lt: new Date(new Date(date).setHours(23, 59, 59))
            }
        });

        if (!dailyInfo) return res.status(404).json({ message: '着用情報が見つかりません' });

        const adjustmentFactor = (feedback - 3) * (-0.5);
        const categoryAdjustments = {
            'outerwear': 1.0, 'tops': 0.8, 'pants': 0.6,
            'skirt': 0.6, 'onepiece': 0.8, 'other': 0.5
        };

        for (const clothId of dailyInfo.clothesIds) {
            const cloth = await Image.findById(clothId);
            if (cloth) {
                const categoryFactor = categoryAdjustments[cloth.category] || 0.5;
                const temperatureAdjustment = Math.round(adjustmentFactor * categoryFactor);
                await Image.findByIdAndUpdate(clothId, { 
                    temperature: cloth.temperature + temperatureAdjustment 
                });
            }
        }
        res.status(200).json({ message: 'フィードバックが正常に処理されました' });
    } catch (error) {
        res.status(500).json({ message: 'フィードバック処理エラー' });
    }
});

app.get('/api/daily-info', async (req, res) => {
    try {
        const { userId, date } = req.query;
        const info = await DailyInfo.findOne({
            userId,
            date: { $gte: new Date(new Date(date).setHours(0,0,0)), $lte: new Date(new Date(date).setHours(23,59,59)) }
        });
        res.json(info);
    } catch (error) {
        res.status(500).json({ message: 'Error' });
    }
});

app.post('/api/clothes-by-ids', async (req, res) => {
    try {
        const clothes = await Image.find({ _id: { $in: req.body.clothesIds } });
        res.json(clothes);
    } catch (error) {
        res.status(500).json({ message: 'Error' });
    }
});

app.post('/api/check-outfit', async (req, res) => {
    try {
        const { userId, date } = req.body;
        const outfit = await DailyInfo.findOne({
            userId,
            date: { $gte: new Date(new Date(date).setHours(0,0,0)), $lte: new Date(new Date(date).setHours(23,59,59)) }
        });
        res.json({ exists: !!outfit, outfitId: outfit ? outfit._id : null });
    } catch (error) {
        res.status(500).json({ error: 'エラー' });
    }
});

app.put('/api/update-outfit/:id', async (req, res) => {
    try {
        const updated = await DailyInfo.findByIdAndUpdate(req.params.id, { clothesIds: req.body.clothesIds }, { new: true });
        res.json(updated);
    } catch (error) {
        res.status(500).json({ error: '更新失敗' });
    }
});

// ==========================================
// 3. 天気予報 API (元 weather.js)
// ==========================================

app.get('/weather', async (req, res) => {
    const { lat, lon } = req.query;
    const apiKey = process.env.OPENWEATHERMAP_API_KEY;
    const url = `https://api.openweathermap.org/data/2.5/weather?lat=${lat}&lon=${lon}&appid=${apiKey}&units=metric`;

    try {
        const response = await fetch(url);
        const data = await response.json();
        if (response.ok) res.json(data);
        else res.status(response.status).json({ error: data.message });
    } catch (error) {
        res.status(500).json({ error: '天気取得エラー' });
    }
});

// --- サーバー起動 ---
app.listen(PORT, () => {
    console.log(`Super Server is running on http://localhost:${PORT}`);
});