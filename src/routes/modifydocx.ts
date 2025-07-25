import { Hono } from 'hono'
import { modifyLeaveApplication, validateParams, type LeaveApplicationParams } from '../tools/word/word.js'
import { db } from '../tools/database/db.js';
import { googleAuthMiddleware, simpleAuthMiddleware, type AuthVariables } from '../middleware/authCheck.js';

// 修正類型定義
const modifydocx = new Hono<{
    Variables: AuthVariables
}>();

// Apply auth middleware to all routes in this file
modifydocx.use('*', googleAuthMiddleware);

// 修改路由路徑：從 '/' 改為 '/modifydocx'
modifydocx.post('/modifydocx', async (c) => {
    try {
        console.log("Received request to /api/modifydocx");
        // 取得使用者 Email
        const userEmail = c.get('userEmail');
        if (!userEmail) {
            console.error("Validation failed: No user email");
            return c.json({ success: false, message: '驗證失敗，無法取得使用者資訊' }, 401);
        }
        console.log(`User email: ${userEmail}`);

        // 解析請求資料
        const formData: LeaveApplicationParams & { emailSubject: string } = await c.req.json();
        console.log("Received form data:", formData);

        // 驗證參數
        const validation = validateParams(formData);
        if (!validation.valid) {
            console.error("Validation failed:", validation.errors);
            return c.json({
                success: false,
                message: '參數驗證失敗',
                errors: validation.errors
            }, 400);
        }
        console.log("Validation successful");

        // 呼叫文件修改功能，直接獲取文件 Buffer
        const result = await modifyLeaveApplication(formData);
        console.log("modifyLeaveApplication result:", result);

        if (result.success && result.fileBuffer) {
            // 將文件 Buffer 存入資料庫
            const dbResult = await db.execute({
                sql: 'INSERT INTO email_docx (user_email, file, file_name, email_subject) VALUES (?, ?, ?, ?)',
                args: [userEmail, result.fileBuffer, `${formData.applicant}_請假申請單.docx`, formData.emailSubject]
            });
            console.log("DB insert result:", dbResult);

            return c.json({
                success: true,
                message: '文件已成功產生並存入資料庫',
                id: Number(dbResult.lastInsertRowid),
                user_email: userEmail
            });

        } else {
            console.error("modifyLeaveApplication failed:", result.message);
            return c.json({
                success: false,
                message: result.message || '產生文件失敗'
            }, 500);
        }

    } catch (error) {
        console.error('修改文件錯誤:', error);
        return c.json({
            success: false,
            message: '內部伺服器錯誤',
            error: error instanceof Error ? error.message : '未知錯誤'
        }, 500);
    }
});

modifydocx.get('/docx-download/:id', simpleAuthMiddleware, async (c) => {
    try {
        const userEmail = c.get('userEmail');
        const fileId = c.req.param('id');

        console.log(`下載請求 - 用戶: ${userEmail}, 文件ID: ${fileId}`);

        const result = await db.execute({
            sql: 'SELECT file, file_name FROM email_docx WHERE id = ? AND user_email = ?',
            args: [fileId, userEmail]
        });

        if (result.rows.length === 0) {
            console.log('找不到指定的檔案');
            return c.json({
                success: false,
                message: '找不到指定的檔案'
            }, 404);
        }

        // 修改 BLOB 數據處理方式
        const fileData = result.rows[0].file;
        let fileBuffer: Buffer;

        // 處理不同類型的數據
        if (Buffer.isBuffer(fileData)) {
            fileBuffer = fileData;
        } else if (fileData instanceof ArrayBuffer) {
            fileBuffer = Buffer.from(fileData);
        } else if (typeof fileData === 'string') {
            // 如果是 base64 字符串
            fileBuffer = Buffer.from(fileData, 'base64');
        } else {
            throw new Error('不支持的文件類型');

        }

        const fileName = result.rows[0].file_name as string;

        console.log(`準備下載文件: ${fileName}, 大小: ${fileBuffer.length} bytes`);

        return new Response(fileBuffer, {
            headers: {
                'Content-Type': 'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
                'Content-Disposition': `attachment; filename*=UTF-8''${encodeURIComponent(fileName)}`,
                'Content-Length': fileBuffer.length.toString(),
                'Cache-Control': 'no-cache',
                'Pragma': 'no-cache'
            }
        });

    } catch (error) {
        console.error('下載檔案錯誤:', error);
        return c.json({
            success: false,
            message: '下載失敗',
            error: error instanceof Error ? error.message : '未知錯誤'
        }, 500);
    }
});

export default modifydocx;