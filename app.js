require('dotenv').config();
const express = require('express');
const mongoose = require('mongoose');
const bcrypt = require('bcrypt');
const jwt = require('jsonwebtoken');
// Node.js標準のcryptoモジュールを使う（インストール不要）
const { randomUUID: uuidv4 } = require('crypto');
const cors = require('cors'); // フロントとポートが違う場合に必須

const app = express();
app.use(express.json());
app.use(cors()); // CORS許可（これがないとスマホから叩けない場合があります）

app.use('/uploads', express.static('uploads'));

// ★重要：JWTの秘密鍵は最初に定義する
const JWT_SECRET = 'your_jwt_secret';

// ★重要：MongoDBへの接続 (127.0.0.1を指定)
// DB名は 'hacku2024' に統一
// mongoose.connect('mongodb://127.0.0.1:27017/your_database') 前のやつ
mongoose.connect('mongodb+srv://ando:xyz6361454@cluster0.rkpeynn.mongodb.net/?appName=Cluster0')
  .then(() => console.log('MongoDB Connected!'))
  .catch(err => console.error('MongoDB Connection Error:', err));

// ユーザーモデルの定義
const User = mongoose.model('User', {
    userId: String,
    email: { type: String, unique: true }, // uniqueインデックスを追加
    password: String,
    displayName: String
});

// メールアドレス重複チェックAPI
app.post('/api/check-email', async (req, res) => {
    try {
        const { email } = req.body;
        const existingUser = await User.findOne({ email });

        if (existingUser) {
            return res.status(400).json({ message: 'このメールアドレスは既に登録されています' });
        }
        return res.status(200).json({ message: 'このメールアドレスは使用可能です' });

    } catch (error) {
        console.error('Check Email Error:', error);
        return res.status(500).json({ message: 'サーバーエラーが発生しました' });
    }
});

// 新規登録API
app.post('/api/register', async (req, res) => {
    try {
        const { email, password, displayName } = req.body;

        // 重複チェック
        const existingUser = await User.findOne({ email });
        if (existingUser) {
            return res.status(400).json({ message: 'このメールアドレスは既に登録されています' });
        }

        // パスワードのハッシュ化
        const hashedPassword = await bcrypt.hash(password, 10);

        // 新規ユーザー作成 (UUIDは衝突しない前提でシンプルに)
        const newUser = new User({
            userId: uuidv4(),
            email,
            password: hashedPassword,
            displayName
        });

        await newUser.save();

        // トークン生成
        const token = jwt.sign(
            { userId: newUser.userId },
            JWT_SECRET,
            { expiresIn: '1h' }
        );

        res.status(201).json({
            message: '登録が完了しました',
            user: {
                id: newUser.userId,
                email: newUser.email,
                displayName: newUser.displayName
            },
            token: token
        });
    } catch (error) {
        console.error('Register Error:', error);
        res.status(500).json({ message: 'サーバーエラーが発生しました' });
    }
});

// ログインAPI
app.post('/api/login', async (req, res) => {
    try {
        const { email, password } = req.body;

        // ユーザー検索
        const user = await User.findOne({ email });
        if (!user) {
            return res.status(401).json({ message: 'メールアドレスまたはパスワードが間違っています' });
        }

        // パスワード照合
        const isMatch = await bcrypt.compare(password, user.password);
        if (!isMatch) {
            return res.status(401).json({ message: 'メールアドレスまたはパスワードが間違っています' });
        }

        // トークン生成
        const token = jwt.sign(
            { userId: user.userId },
            JWT_SECRET,
            { expiresIn: '1h' }
        );

        res.json({
            message: 'ログインに成功しました',
            token: token,
            user: {
                id: user.userId,
                email: user.email,
                displayName: user.displayName
            }
        });
    } catch (error) {
        console.error('Login Error:', error);
        res.status(500).json({ message: 'ログインに失敗しました' });
    }
});

const PORT = process.env.PORT || 3000;
app.listen(PORT, () => console.log(`Server running on port ${PORT}`));