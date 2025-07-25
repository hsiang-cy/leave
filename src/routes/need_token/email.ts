import { Hono } from "hono";
import { google, gmail_v1 } from 'googleapis';
import { googleAuthMiddleware } from "../../middleware/authCheck.js"; // 假設路徑正確
import { Context, Next } from 'hono';
import { db } from '@database/db.js';

const email = new Hono<{
    Variables: {
        googleAuth: any; // 建議定義更精確的型別
        userEmail: string;
        user: { name: string }; // 建議定義更精確的型別
    }
}>();

// 正確使用中介層
email.use('*', googleAuthMiddleware);

email.post('/send', async (c) => {
    try {
        const googleAuth = c.get('googleAuth');
        const userEmail = c.get('userEmail');
        const user = c.get('user');

        if (!googleAuth || !userEmail || !user) {
            return c.json({
                success: false,
                message: '驗證失敗，缺少必要的認證資訊'
            }, 401);
        }

        const gmail = google.gmail({ version: 'v1', auth: googleAuth });

        // RFC 2047: To include non-ASCII characters (like Chinese) in email headers (e.g., Subject),
        // they must be encoded. Here, we use UTF-8 with Base64 encoding.
        // Format: =?charset?encoding?encoded-text?=
        const subject = '測試郵件 - 來自 Node.js Gmail API';
        const encodedSubject = `=?UTF-8?B?${Buffer.from(subject).toString('base64')}?=`;

        const emailContent = [
            'Content-Type: text/html; charset="UTF-8"',
            'MIME-Version: 1.0',
            `To: ${userEmail}`,
            `Subject: ${encodedSubject}`, // Use the encoded subject
            '',
            '<html>',
            '<body>',
            '<h2>🎉 這是一封測試郵件！</h2>',
            `<p>Hello ${user.name}! 這是透過 Gmail API 發送的測試郵件。</p>`,
            '<p><strong>發送時間：</strong>' + new Date().toLocaleString('zh-TW') + '</p>',
            '<p><strong>來源：</strong>Node.js + Hono + Gmail API</p>',
            '<hr>',
            '<p style="color: #666; font-size: 12px;">',
            '這是一封自動生成的測試郵件，請勿回覆。',
            '</p>',
            '</body>',
            '</html>'
        ].join('\n');

        const encodedEmail = Buffer.from(emailContent)
            .toString('base64')
            .replace(/\+/g, '-')
            .replace(/\//g, '_')
            .replace(/=+\$/, '');

        const response = await gmail.users.messages.send({
            userId: 'me',
            requestBody: {
                raw: encodedEmail
            }
        });

        console.log('📧 郵件發送成功:', {
            messageId: response.data.id,
            threadId: response.data.threadId,
            user: userEmail,
            timestamp: new Date().toISOString()
        });

        return c.json({
            success: true,
            message: '📧 測試郵件發送成功！',
            data: {
                messageId: response.data.id,
                threadId: response.data.threadId,
                recipient: userEmail,
                subject: '測試郵件 - 來自 Node.js Gmail API',
                sentAt: new Date().toISOString()
            }
        });

    } catch (error) {
        console.error('❌ 郵件發送失敗:', error);

        if (error instanceof Error) {
            if (error.message.includes('insufficient')) {
                return c.json({
                    success: false,
                    message: '權限不足，請重新登入以取得 Gmail 發送權限',
                    error: '需要 gmail.send 權限'
                }, 403);
            }
        }

        return c.json({
            success: false,
            message: '郵件發送失敗',
            error: error instanceof Error ? error.message : '未知錯誤'
        }, 500);
    }
});

// 新增發送附件郵件的路由
email.post('/send-with-attachment', async (c) => {
    try {
        const googleAuth = c.get('googleAuth');
        const userEmail = c.get('userEmail');
        const user = c.get('user');

        if (!googleAuth || !userEmail || !user) {
            return c.json({
                success: false,
                message: '驗證失敗，缺少必要的認證資訊'
            }, 401);
        }

        const { docxId, recipient, cc, message } = await c.req.json();

        // 從資料庫取得檔案
        const fileResult = await db.execute({
            sql: 'SELECT file, file_name, email_subject FROM email_docx WHERE id = ? AND user_email = ?',
            args: [docxId, userEmail]
        });

        if (fileResult.rows.length === 0) {
            return c.json({
                success: false,
                message: '找不到指定的檔案'
            }, 404);
        }

        const fileData = fileResult.rows[0].file as unknown as ArrayBuffer;
        const fileName = fileResult.rows[0].file_name as string;
        const subject = fileResult.rows[0].email_subject as string;
        const fileBuffer = Buffer.from(fileData);
        const gmail = google.gmail({ version: 'v1', auth: googleAuth });

        // 構建郵件內容
        const boundary = 'boundary_' + Date.now();
        const emailContent = [
            `Content-Type: multipart/mixed; boundary="${boundary}"`,
            'MIME-Version: 1.0',
            `To: ${recipient}`,
            ...(cc ? [`Cc: ${cc}`] : []),
            `Subject: =?UTF-8?B?${Buffer.from(subject).toString('base64')}?= `,
            '',
            `--${boundary}`,
            'Content-Type: text/plain; charset="UTF-8"',
            '',
            message || '請參閱附件。',
            '',
            `--${boundary}`,
            'Content-Type: application/vnd.openxmlformats-officedocument.wordprocessingml.document',
            `Content-Disposition: attachment; filename="${fileName}"`,
            'Content-Transfer-Encoding: base64',
            '',
            fileBuffer.toString('base64'),
            '',
            `--${boundary}--`
        ].join('\n');

        const encodedEmail = Buffer.from(emailContent)
            .toString('base64')
            .replace(/\+/g, '-')
            .replace(/\//g, '_')
            .replace(/=+$/, '');

        const response = await gmail.users.messages.send({
            userId: 'me',
            requestBody: {
                raw: encodedEmail
            }
        });

        console.log('📧 附件郵件發送成功:', {
            messageId: response.data.id,
            recipient,
            cc,
            subject
        });

        return c.json({
            success: true,
            message: '郵件已成功發送（含附件）！',
            data: {
                messageId: response.data.id,
                recipient,
                cc,
                subject
            }
        });

    } catch (error) {
        console.error('❌ 附件郵件發送失敗:', error);
        return c.json({
            success: false,
            message: '郵件發送失敗',
            error: error instanceof Error ? error.message : '未知錯誤'
        }, 500);
    }
});

export default email;
