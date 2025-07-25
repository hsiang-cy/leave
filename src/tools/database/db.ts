import { createClient } from "@libsql/client";

export const db = createClient({
  url: "file:data/database.db"
});

export async function initializeDatabase() {
  try {
    await db.execute(`
      CREATE TABLE IF NOT EXISTS users (
        name TEXT NOT NULL,
        email TEXT PRIMARY KEY
      )
    `);

    // await db.execute(`
    //   CREATE TABLE IF NOT EXISTS leave (
    //     id INTEGER PRIMARY KEY,
    //     create_time TEXT DEFAULT CURRENT_TIMESTAMP,
    //     update_time TEXT DEFAULT CURRENT_TIMESTAMP,
    //     start_time TEXT NOT NULL,
    //     end_time TEXT NOT NULL,
    //     user_email TEXT NOT NULL,
    //     FOREIGN KEY (user_email) REFERENCES users(email)
    //   )
    // `);

    await db.execute(`
      CREATE TABLE IF NOT EXISTS token (
        id INTEGER PRIMARY KEY,
        create_time TEXT DEFAULT CURRENT_TIMESTAMP,
        update_time TEXT DEFAULT CURRENT_TIMESTAMP,
        access_token TEXT NOT NULL,
        access_token_expiration_time TEXT NOT NULL,
        refresh_token TEXT NOT NULL,
        refresh_token_expiration_time TEXT NOT NULL,
        user_email TEXT NOT NULL,
        info TEXT NOT NULL,
        FOREIGN KEY (user_email) REFERENCES users(email)
      )
    `);

    await db.execute(`
      CREATE TABLE IF NOT EXISTS email_docx (
        id INTEGER PRIMARY KEY,
        create_time TEXT DEFAULT CURRENT_TIMESTAMP,
        file BLOB NOT NULL,
        file_name TEXT,
        email_subject TEXT,
        is_sent BOOLEAN DEFAULT false,
        user_email TEXT NOT NULL,
        FOREIGN KEY (user_email) REFERENCES users(email)
      )
    `);

    // await db.execute(`
    //   CREATE TABLE IF NOT EXISTS email_log (
    //     id INTEGER PRIMARY KEY,
    //     create_time TEXT DEFAULT CURRENT_TIMESTAMP,
    //     update_time TEXT DEFAULT CURRENT_TIMESTAMP,
    //     from_address TEXT NOT NULL,
    //     to_address TEXT NOT NULL,
    //     cc_address TEXT NOT NULL,
    //     subject TEXT NOT NULL,
    //     body TEXT NOT NULL,
    //     allow_url TEXT NOT NULL,
    //     allow_url_expiration_time TEXT NOT NULL,
    //     attachment_id INTEGER NOT NULL,
    //     user_email TEXT NOT NULL,
    //     FOREIGN KEY (attachment_id) REFERENCES email_docx(id),
    //     FOREIGN KEY (user_email) REFERENCES users(email)
    //   )
    // `);

    await db.execute({
      sql: `
        INSERT INTO users (name, email) 
        VALUES (?, ?) 
        ON CONFLICT(email) DO UPDATE SET 
          name = excluded.name
      `,
      args: ['sean', 'sean@gmail.com']
    });

    console.log("資料庫初始化完成");
  } catch (error) {
    console.error("資料庫初始化失敗:", error);
    throw error;
  }
}
