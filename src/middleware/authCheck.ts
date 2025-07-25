import { Context, Next } from 'hono'
import { google } from 'googleapis'
import { OAuth2Client } from 'google-auth-library';
import { db } from '@database/db.js'
import jwt from 'jsonwebtoken'
import { createMiddleware } from 'hono/factory'

// 定義我們的變數類型
export interface AuthVariables {
    user: AuthUser
    userEmail: string
    userName: string
    googleAuth: OAuth2Client
}

// 定義用戶認證相關的類型
export interface AuthUser {
    email: string
    name: string
    googleAuth: OAuth2Client
}

// JWT 密鑰（建議放在環境變數中）
const JWT_SECRET = process.env.JWT_SECRET || 'your-super-secret-jwt-key'

/**
 * 驗證 JWT Token 並返回用戶信息
 */
function verifyJWTToken(token: string): { email: string; name: string } | null {
    try {
        const decoded = jwt.verify(token, JWT_SECRET) as any
        return {
            email: decoded.email,
            name: decoded.name
        }
    } catch (error) {
        console.error('JWT 驗證失敗:', error)
        return null
    }
}

/**
 * 生成 JWT Token
 * @param  email - 用戶的電子郵件地址
 * @param  name - 用戶的名字
 * @param  expire - JWT Token 的有效期
 * @returns {string}
 */
export function generateJWTToken(email: string, name: string, expire: number = 1800): string {
    return jwt.sign(
        { email, name },
        JWT_SECRET,
        { expiresIn: expire } // JWT 有效期為 1 小時
    )
}

/**
 * 從資料庫獲取用戶的 Google tokens
 */
async function getUserGoogleTokens(userEmail: string) {
    const result = await db.execute({
        sql: 'SELECT access_token, refresh_token, access_token_expiration_time FROM token WHERE user_email = ?',
        args: [userEmail]
    })

    if (result.rows.length === 0) {
        throw new Error('找不到用戶的 Google 認證信息')
    }

    return result.rows[0]
}

/**
 * 更新資料庫中的 tokens
 */
async function updateGoogleTokens(userEmail: string, tokens: any) {
    await db.execute({
        sql: `UPDATE token SET 
          access_token = ?, 
          access_token_expiration_time = ?, 
          refresh_token = COALESCE(?, refresh_token),
          update_time = CURRENT_TIMESTAMP 
          WHERE user_email = ?`,
        args: [
            tokens.access_token,
            tokens.expiry_date,
            tokens.refresh_token,
            userEmail
        ]
    })
}

/**
 * 創建用戶專用的 OAuth2Client
 */
async function createUserGoogleAuth(userEmail: string): Promise<OAuth2Client> {
    const userTokens = await getUserGoogleTokens(userEmail)

    const oauth2Client = new google.auth.OAuth2(
        process.env.GOOGLE_CLIENT_ID,
        process.env.GOOGLE_CLIENT_SECRET,
        process.env.GOOGLE_REDIRECT_URI
    )

    oauth2Client.setCredentials({
        access_token: userTokens.access_token as string,
        refresh_token: userTokens.refresh_token as string,
        expiry_date: parseInt(userTokens.access_token_expiration_time as string)
    })

    oauth2Client.on('tokens', async (tokens) => {
        console.log('🔄 用戶 Google tokens 已更新:', userEmail)
        try {
            await updateGoogleTokens(userEmail, tokens)
        } catch (error) {
            console.error('更新 tokens 到資料庫失敗:', error)
        }
    })

    return oauth2Client
}

/**
 * Google 認證中間件 - 使用 createMiddleware 來確保類型安全
 */
export const googleAuthMiddleware =
    createMiddleware<{ Variables: AuthVariables }>(async (c, next) => {
        try {
            // 1. 從請求頭獲取 Authorization token
            const authHeader = c.req.header('Authorization')

            if (!authHeader || !authHeader.startsWith('Bearer ')) {
                return c.json({
                    success: false,
                    message: '缺少認證信息，請提供 Authorization header'
                }, 401)
            }

            // 2. 提取並驗證 JWT token
            const token = authHeader.split(' ')[1]
            const userInfo = verifyJWTToken(token)

            if (!userInfo) {
                return c.json({
                    success: false,
                    message: 'Token 無效或已過期，請重新登入'
                }, 401)
            }

            // 3. 驗證用戶是否存在於資料庫中
            const userCheck = await db.execute({
                sql: 'SELECT email, name FROM users WHERE email = ?',
                args: [userInfo.email]
            })

            if (userCheck.rows.length === 0) {
                return c.json({
                    success: false,
                    message: '用戶不存在，請重新註冊'
                }, 401)
            }

            // 4. 創建用戶專用的 Google OAuth2Client
            const googleAuth = await createUserGoogleAuth(userInfo.email)

            // 5. 將用戶信息和 Google 認證實例加到 context 中
            const authUser: AuthUser = {
                email: userInfo.email,
                name: userInfo.name,
                googleAuth
            }

            c.set('user', authUser)
            c.set('userEmail', userInfo.email)
            c.set('userName', userInfo.name)
            c.set('googleAuth', googleAuth)

            console.log(`token: ${token}`);

            // 6. 繼續處理下一個中間件或路由
            await next()

        } catch (error) {
            console.error('❌ Google 認證中間件失敗:', error)

            if (error instanceof Error) {
                if (error.message.includes('找不到用戶的 Google 認證信息')) {
                    return c.json({
                        success: false,
                        message: '用戶未授權 Google 服務，請重新登入'
                    }, 401)
                }

                if (error.message.includes('invalid_grant') || error.message.includes('Token has been expired')) {
                    return c.json({
                        success: false,
                        message: 'Google 授權已過期，請重新登入'
                    }, 401)
                }
            }

            return c.json({
                success: false,
                message: '認證失敗，請重新登入',
                error: error instanceof Error ? error.message : '未知錯誤'
            }, 500)
        }
    })

/**
 * 簡化的認證中間件 - 僅檢查用戶身份，不創建 Google 認證
 */
export const simpleAuthMiddleware = // Pick 是啥？
    createMiddleware<{ Variables: Pick<AuthVariables, 'userEmail' | 'userName'> }>(async (c, next) => {
        try {
            const authHeader = c.req.header('Authorization')

            if (!authHeader || !authHeader.startsWith('Bearer ')) {
                return c.json({
                    success: false,
                    message: '缺少認證信息'
                }, 401)
            }

            const token = authHeader.split(' ')[1]
            const userInfo = verifyJWTToken(token)

            if (!userInfo) {
                return c.json({
                    success: false,
                    message: 'Token 無效或已過期'
                }, 401)
            }

            c.set('userEmail', userInfo.email)
            c.set('userName', userInfo.name)

            console.log(`token: ${token}`);


            await next()
        } catch (error) {
            console.error('簡單認證中間件失敗:', error)
            return c.json({
                success: false,
                message: '認證失敗'
            }, 401)
        }
    })

export async function test_middle(c: Context, next: Next) {
    console.log('test_middle')
    next()
    console.log('test_middle end')
}