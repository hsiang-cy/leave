import { Hono } from 'hono';
import { google, oauth2_v2, gmail_v1 } from 'googleapis';
import { OAuth2Client, Credentials } from 'google-auth-library';
import { db } from '@database/db.js';
import { googleAuthMiddleware, generateJWTToken, type AuthVariables } from '../middleware/authCheck.js';

// 定義這個路由的類型
type AuthEnv = {
    Variables: AuthVariables
}

const auth = new Hono<AuthEnv>();

// 創建基礎的 OAuth2Client（僅用於登入流程）
const oauth2Client: OAuth2Client = new google.auth.OAuth2(
    process.env.GOOGLE_CLIENT_ID,
    process.env.GOOGLE_CLIENT_SECRET,
    process.env.GOOGLE_REDIRECT_URI
);

auth.get('/google/login', (c) => {
    const scopes = [
        'openid',
        'https://www.googleapis.com/auth/userinfo.email',
        'https://www.googleapis.com/auth/userinfo.profile',
        'https://www.googleapis.com/auth/gmail.send'
    ];

    const url = oauth2Client.generateAuthUrl({
        access_type: 'offline',
        prompt: 'consent',
        scope: scopes,
        hd: process.env.HOSTED_DOMAIN!
    });

    return c.redirect(url);
});

auth.get('/google/login/callback', async (c) => {
    const { code } = c.req.query();

    if (!code || typeof code !== 'string') {
        return c.text('沒有收到 Authorization code', 400);
    }

    try {
        const { tokens }: { tokens: Credentials } = await oauth2Client.getToken(code);
        oauth2Client.setCredentials(tokens);

        const oauth2 = google.oauth2({ auth: oauth2Client, version: 'v2' });
        const { data: userInfo }: { data: oauth2_v2.Schema$Userinfo } = await oauth2.userinfo.get();

        const user_email = await db.execute({
            sql: `select email from users where email = ?`,
            args: [userInfo.email!]
        })

        let message

        if (user_email.rows.length === 0) {
            await db.execute({
                sql: `insert into users (name, email) values (?, ?)`,
                args: [userInfo.name!, userInfo.email!]
            });
            await db.execute({
                sql: `insert into token (access_token, access_token_expiration_time, refresh_token, refresh_token_expiration_time, user_email, info) values (?, ?, ?, ?, ?, ?)`,
                args: [tokens.access_token!, tokens.expiry_date!, tokens.refresh_token!, tokens.expiry_date!, userInfo.email!, JSON.stringify(tokens) || '{}']
            })

            message = '🎉 註冊成功！'
            console.log(message, {
                name: userInfo.name,
                email: userInfo.email,
                access_token: tokens.access_token,
                refresh_token: tokens.refresh_token
            });
        }
        else if (user_email.rows.length === 1) {
            await db.execute({
                sql: `update token set update_time = CURRENT_TIMESTAMP, access_token = ?, access_token_expiration_time = ?, refresh_token = ?, refresh_token_expiration_time = ?, info = ? where user_email = ?`,
                args: [tokens.access_token!, tokens.expiry_date!, tokens.refresh_token!, tokens.expiry_date!, JSON.stringify(tokens) || '{}', userInfo.email!]
            });

            message = '🎉 登入成功！'
            console.log(message, {
                name: userInfo.name,
                email: userInfo.email,
                access_token: tokens.access_token,
                refresh_token: tokens.refresh_token
            });
        }

        // 生成 JWT token 給前端使用
        const jwtToken = generateJWTToken(userInfo.email!, userInfo.name!);

        // 清除全域 oauth2Client 的 credentials（避免全域狀態污染）
        oauth2Client.setCredentials({});

        return c.redirect(`/html/00-login.html?token=${encodeURIComponent(jwtToken)}`);


    } catch (error) {
        console.error('❌ 認證過程發生錯誤:', error);
        return c.redirect(`/html/00-login.html?error=${encodeURIComponent(error instanceof Error ? error.message : '未知錯誤')}`);
    }
});

// 使用中間件的路由
auth.post('/token/check', googleAuthMiddleware, async (c) => {
    try {
        const userEmail = c.var.userEmail;
        const googleAuth = c.var.googleAuth;

        const oauth2 = google.oauth2({ auth: googleAuth, version: 'v2' });
        const { data: userInfo }: { data: oauth2_v2.Schema$Userinfo } = await oauth2.userinfo.get();

        return c.json({
            success: true,
            message: 'Token 驗證成功',
            user: {
                id: userInfo.id,
                name: userInfo.name,
                email: userInfo.email,
                picture: userInfo.picture,
                verified_email: userInfo.verified_email
            }
        });

    } catch (error) {
        console.error('❌ Token 驗證失敗:', error);
        return c.json({
            success: false,
            message: 'Token 驗證失敗',
            error: error instanceof Error ? error.message : '未知錯誤'
        }, 400);
    }
});

auth.get('/user/profile', googleAuthMiddleware, async (c) => {
    try {
        const googleAuth = c.var.googleAuth;

        const oauth2 = google.oauth2({ auth: googleAuth, version: 'v2' });
        const { data: userInfo }: { data: oauth2_v2.Schema$Userinfo } = await oauth2.userinfo.get();

        return c.json({
            success: true,
            user: userInfo
        });

    } catch (error) {
        console.error('❌ 獲取用戶資訊失敗:', error);
        return c.json({
            success: false,
            message: '獲取用戶資訊失敗，可能需要重新登入',
            error: error instanceof Error ? error.message : '未知錯誤'
        }, 401);
    }
});


export default auth;