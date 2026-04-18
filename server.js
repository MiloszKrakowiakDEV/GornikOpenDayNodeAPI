require('dotenv').config();
const http = require('http');
const mysql = require('mysql2/promise');
const bcrypt = require("bcrypt");
const crypto = require('crypto');
const fs = require('fs');
const path = require('path');
const { google } = require('googleapis');
const nodemailer = require('nodemailer');
const SALT_ROUNDS = 10;
const emailTemplate = fs.readFileSync(path.join(__dirname, 'email.html'), 'utf8');

const pool = mysql.createPool({
    host: process.env.DB_HOST,
    user: process.env.DB_USER,
    password: process.env.DB_PASSWORD,
    database: process.env.DB_NAME,
    port: process.env.DB_PORT || 3306,
    waitForConnections: true,
    connectionLimit: 10,
    queueLimit: 0
});

async function sendMail(email, user_token) {
    const oAuth2Client = new google.auth.OAuth2(
        process.env.OAUTH_ID,
        process.env.OAUTH_SECRET,
        'https://developers.google.com/oauthplayground'
    );

    oAuth2Client.setCredentials({ refresh_token: process.env.OAUTH_REFRESH });
    const gmail = google.gmail({ version: 'v1', auth: oAuth2Client });

    const verificationUrl = `https://gornikopendaynodeapi.onrender.com/email/verify?token=${user_token}`;
    const finalHtml = emailTemplate.replace(/{{verification_link}}/g, verificationUrl);

    const encodeWord = (word) => `=?utf-8?B?${Buffer.from(word).toString('base64')}?=`;

    const displayName = encodeWord("Zespół Górnik TBG");
    const subject = encodeWord("Weryfikacja konta - GórnikOpen");

    const messageParts = [
        `From: ${displayName} <${process.env.GMAIL_LOGIN}>`,
        `To: ${email}`,
        'Content-Type: text/html; charset=utf-8',
        'MIME-Version: 1.0',
        `Subject: ${subject}`,
        '',
        finalHtml,
    ];

    const message = messageParts.join('\n');

    const encodedMessage = Buffer.from(message)
        .toString('base64')
        .replace(/\+/g, '-')
        .replace(/\//g, '_')
        .replace(/=+$/, '');

    try {
        const res = await gmail.users.messages.send({
            userId: 'me',
            requestBody: {
                raw: encodedMessage,
            },
        });
        console.log('Message sent! ID:', res.data.id);
    } catch (error) {
        console.error('API Error:', error.response ? error.response.data : error);
    }
}

const server = http.createServer(async (req, res) => {
    console.log("Got a request");
    let body = ""
    if (req.method === "POST") {
        switch (req.url) {
            case "/user/add":
                let connection;
                body = "";
                req.on("data", chunk => {
                    body += chunk.toString();
                });

                req.on("end", async () => {
                    try {
                        const data = JSON.parse(body);
                        connection = await pool.getConnection()
                        if (!data.email || !data.password) {
                            res.writeHead(400, { 'Content-Type': 'application/json' });
                            return res.end(JSON.stringify({ error: "Brak adresu email lub hasła" }));
                        }

                        const hashedPassword = await bcrypt.hash(data.password, SALT_ROUNDS);
                        const buffer = crypto.randomBytes(32);
                        const token = buffer.toString('hex');
                        await connection.execute(
                            'DELETE FROM users WHERE verified = false AND email = ?',
                            [data.email]
                        )
                        await connection.execute(
                            `INSERT INTO users(email, password, points, verification_token)
                             VALUES (?, ?, ?, ?)`,
                            [data.email, hashedPassword, 0, token]
                        );
                        console.log("Email: " + data.email)
                        await sendMail(data.email, token)

                        res.writeHead(201, { 'Content-Type': 'application/json' });
                        res.end(JSON.stringify({ message: "Sprawdź pocztę email" }));

                    } catch (err) {
                        console.error(err);

                        if (err.code === "ER_DUP_ENTRY") {
                            res.writeHead(409, { 'Content-Type': 'application/json' });
                            return res.end(JSON.stringify({ error: "Użytkownik już istnieje" }));
                        }

                        if (err.code === "ER_BAD_NULL_ERROR") {
                            res.writeHead(400, { 'Content-Type': 'application/json' });
                            return res.end(JSON.stringify({ error: "Brak wymaganych danych" }));
                        }

                        if (err instanceof SyntaxError) {
                            res.writeHead(400, { 'Content-Type': 'application/json' });
                            return res.end(JSON.stringify({ error: "Niepoprawny JSON" }));
                        }

                        res.writeHead(500, { 'Content-Type': 'application/json' });
                        res.end(JSON.stringify({ error: "Błąd serwera" }));
                    } finally {
                        if (connection) connection.release();
                    }
                });

                break;
            case "/user/getByEmailAndPassword":
                body = "";

                req.on("data", chunk => {
                    body += chunk.toString();
                });

                req.on("end", async () => {
                    let connection;

                    try {
                        const data = JSON.parse(body);

                        if (!data.email || !data.password) {
                            res.writeHead(400, { 'Content-Type': 'application/json' });
                            return res.end(JSON.stringify({ error: "Brak nazwy użytkownika lub hasła" }));
                        }

                        connection = await pool.getConnection();

                        const [rows] = await connection.execute(
                            `SELECT password
                             FROM users
                             WHERE email = ?
                               AND verified = true`,
                            [data.email]
                        );

                        if (rows.length === 0) {
                            throw new Error("Nieprawidłowe dane logowania");
                            ;
                        } else {
                            const hashedPassword = rows[0].password;
                            if (await bcrypt.compare(data.password, hashedPassword)) {
                                const [rows] = await connection.execute(
                                    `SELECT id, email, points, creation_date as creationDate
                                     FROM users
                                     WHERE email = ?`,
                                    [data.email]
                                );
                                console.log(rows[0])
                                res.writeHead(201, { 'Content-Type': 'application/json' });
                                const user = rows[0];
                                console.log(JSON.stringify(user))
                                res.end(JSON.stringify(user));
                            } else {
                                throw new Error("Nieprawidłowe dane logowania");
                                ;
                            }

                        }


                    } catch (err) {
                        console.error(err)
                        res.writeHead(401, { 'Content-Type': 'application/json' });
                        res.end(JSON.stringify({ error: err.message }));
                    } finally {
                        if (connection) connection.release();
                    }
                });
                break;
            case "/user/delete":
                body = "";

                req.on("data", chunk => {
                    body += chunk.toString();
                });

                req.on("end", async () => {
                    let connection;

                    try {
                        const data = JSON.parse(body);

                        if (!data.username) {
                            res.writeHead(400, { 'Content-Type': 'application/json' });
                            return res.end(JSON.stringify({ error: "Użytkownik nie istnieje" }));
                        }
                        connection = await pool.getConnection();
                        const [rows] = await connection.execute(
                            `SELECT id
                             FROM users
                             WHERE email = ?`,
                            [data.email]
                        );

                        if (rows.length === 0) {
                            throw new Error("Użytkownik nie istnieje");
                            ;
                        } else {
                            const selectedUser = rows[0];
                            const val1 = await connection.execute(
                                'DELETE FROM user_questions_answered WHERE user_id = ?',
                                [selectedUser.id]
                            )
                            const val2 = await connection.execute(
                                'DELETE FROM users WHERE id = ?',
                                [selectedUser.id]
                            )
                            res.writeHead(201, { 'Content-Type': 'application/json' });
                            res.end(JSON.stringify({ message: "Konto zostało usunięte" }));

                        }


                    } catch (err) {
                        console.error(err)
                        res.writeHead(401, { 'Content-Type': 'application/json' });
                        res.end(JSON.stringify({ error: err.message }));
                    } finally {
                        if (connection) connection.release();
                    }
                });

                break;
            case "/user/changePassword":
                body = "";

                req.on("data", chunk => {
                    body += chunk.toString();
                });

                req.on("end", async () => {
                    let connection;
                    try {
                        const data = JSON.parse(body);

                        if (!data.email || !data.oldPassword || !data.newPassword) {
                            res.writeHead(400, { 'Content-Type': 'application/json' });
                            throw new Error("Brak nazwy użytkownika, hasła lub nowego hasła");
                        }
                        connection = await pool.getConnection();
                        const [rows] = await connection.execute(
                            `SELECT password, id
                             FROM users
                             WHERE email = ?`,
                            [data.email]
                        );

                        if (rows.length === 0) {
                            throw new Error("Nieprawidłowe dane logowania");
                            ;
                        } else {
                            const hashedPassword = rows[0].password;
                            if (await bcrypt.compare(data.oldPassword, hashedPassword)) {
                                const new_password = await bcrypt.hash(data.newPassword, SALT_ROUNDS);
                                const [] = await connection.execute(
                                    'UPDATE users SET password = ? WHERE id = ?',
                                    [new_password, rows[0].id]
                                )
                                res.writeHead(201, { 'Content-Type': 'application/json' });
                                res.end(JSON.stringify({ message: "Poprawnie zmieniono hasło" }));
                            } else {
                                throw new Error("Nieprawidłowe dane logowania");
                                ;
                            }

                        }

                    } catch (err) {
                        console.error(err)
                        res.writeHead(401, { 'Content-Type': 'application/json' });
                        res.end(JSON.stringify({ error: err.message }));
                    } finally {
                        if (connection) connection.release();
                    }
                });

                break;
            case "/score/getTopTenUsers":
                body = "";

                req.on("data", chunk => {
                    body += chunk.toString();
                });

                req.on("end", async () => {
                    let connection;

                    try {
                        connection = await pool.getConnection();
                        const [rows] = await connection.execute(
                            `SELECT CONCAT(SUBSTR(u.email,1,3),'<adres>@poczta.pl') as "email", u.points, sum(uqa.time_spent) as 'timeSpentTotal' FROM users u
INNER JOIN user_questions_answered uqa ON u.id = uqa.user_id
GROUP BY u.email, u.points, uqa.correct 
HAVING uqa.correct = true
ORDER BY u.points DESC, sum(uqa.time_spent) ASC, u.email ASC LIMIT 10`
                        );
                        res.writeHead(201, { 'Content-Type': 'application/json' });
                        res.end(JSON.stringify(rows));

                    } catch (err) {
                        console.error(err)
                        res.writeHead(401, { 'Content-Type': 'application/json' });
                        res.end(JSON.stringify({ error: err.message }));
                    } finally {
                        if (connection) connection.release();
                    }
                });

                break;
            case "/score/getTopTenUsersForSubject":
                body = "";

                req.on("data", chunk => {
                    body += chunk.toString();
                });

                req.on("end", async () => {
                    let connection;

                    try {
                        const data = JSON.parse(body);
                        connection = await pool.getConnection();
                        const [rows] = await connection.execute(
                            `SELECT CONCAT(SUBSTR(u.email,1,3),'<adres>@poczta.pl') as "email", u.points-(select sum(points_awarded) from questions where questions.subject <> ? limit 1) as "points", sum(uqa.time_spent) as 'timeSpentTotal' FROM users u
INNER JOIN user_questions_answered uqa ON u.id = uqa.user_id
INNER JOIN questions q ON q.id = uqa.question_id 
GROUP BY u.email, u.points, uqa.correct, q.subject 
HAVING uqa.correct = true AND q.subject = ?
ORDER BY u.points DESC, sum(uqa.time_spent) ASC, u.email ASC LIMIT 10`,
                            [data.subject, data.subject]
                        );
                        res.writeHead(201, { 'Content-Type': 'application/json' });
                        res.end(JSON.stringify(rows));

                    } catch (err) {
                        console.error(err)
                        res.writeHead(401, { 'Content-Type': 'application/json' });
                        res.end(JSON.stringify({ error: err.message }));
                    } finally {
                        if (connection) connection.release();
                    }
                });

                break;
            case "/user/getPosition":
                body = "";

                req.on("data", chunk => {
                    body += chunk.toString();
                });

                req.on("end", async () => {
                    let connection;
                    try {
                        const data = JSON.parse(body);
                        connection = await pool.getConnection();
                        const [rows] = await connection.execute(
                            `SELECT u.email, u.points, sum(uqa.time_spent) as total_time_spent FROM users u
INNER JOIN user_questions_answered uqa ON u.id = uqa.user_id
GROUP BY u.email, u.points, uqa.correct 
having u.email=?
ORDER BY u.points DESC, sum(uqa.time_spent) ASC, u.email ASC `,
                            [data.email]
                        );
                        console.log("Email " + data.email)
                        console.log("Rows " + rows[0])
                        if (rows.length === 0) {
                            throw new Error("Nieprawidłowe dane logowania");;
                        } else {
                            const [val] = await connection.execute(
                                `select count(*) + 1 as "message" from (SELECT u.email, u.points, sum(uqa.time_spent) FROM users u
INNER JOIN user_questions_answered uqa ON u.id = uqa.user_id
GROUP BY u.email, u.points, uqa.correct 
HAVING (points > ? OR (points = ? AND sum(uqa.time_spent) < ?)) AND email <> ?
ORDER BY u.points DESC, sum(uqa.time_spent) ASC, u.email ASC) as "Merged Table"`,
                                [rows[0].points, rows[0].points, rows[0].total_time_spent, data.email]
                            );
                            res.writeHead(201, { 'Content-Type': 'application/json' });
                            res.end(JSON.stringify(val[0]));
                        }
                    } catch (err) {
                        console.error(err)
                        res.writeHead(401, { 'Content-Type': 'application/json' });
                        res.end(JSON.stringify({ error: err.message }));
                    } finally {
                        if (connection) connection.release();
                    }
                });
                break;
            case "/user/getPositionForSubject":
                body = "";

                req.on("data", chunk => {
                    body += chunk.toString();
                });

                req.on("end", async () => {
                    let connection;
                    try {
                        const data = JSON.parse(body);
                        connection = await pool.getConnection();
                        const [rows] = await connection.execute(
                            `SELECT u.email, u.points-(select sum(points_awarded) from questions where questions.subject <> ? limit 1) as "points", sum(uqa.time_spent) as total_time_spent FROM users u
INNER JOIN user_questions_answered uqa ON u.id = uqa.user_id
INNER JOIN questions q ON q.id = uqa.question_id 
GROUP BY u.email, u.points, uqa.correct, q.subject
having u.email=? AND uqa.correct=true AND q.subject  = ?
ORDER BY u.points DESC, sum(uqa.time_spent) ASC, u.email ASC `,
                            [data.subject, data.email, data.subject]
                        );
                        if (rows.length === 0) {
                            throw new Error("Nieprawidłowe dane logowania");;
                        } else {
                            const [val] = await connection.execute(
                                `select count(*) + 1 as "message" from (
SELECT u.email, u.points-(select sum(points_awarded) from questions where questions.subject <> ? limit 1) as "points", sum(uqa.time_spent) as total_time_spent FROM users u
INNER JOIN user_questions_answered uqa ON u.id = uqa.user_id
INNER JOIN questions q ON q.id = uqa.question_id 
GROUP BY u.email, u.points, uqa.correct, q.subject
having u.email<>? AND (points > ? OR (points = ? AND sum(uqa.time_spent) < ?))
ORDER BY u.points DESC, sum(uqa.time_spent) ASC, u.email ASC 
) as "Merged Table"`,
                                [data.subject,data.email, rows[0].points, rows[0].points, rows[0].total_time_spent, data.email]
                            );
                            res.writeHead(201, { 'Content-Type': 'application/json' });
                            res.end(JSON.stringify(val[0]));
                        }
                    } catch (err) {
                        console.error(err)
                        res.writeHead(401, { 'Content-Type': 'application/json' });
                        res.end(JSON.stringify({ error: err.message }));
                    } finally {
                        if (connection) connection.release();
                    }
                });
                break;
            case "/user/getPoints":
                body = "";

                req.on("data", chunk => {
                    body += chunk.toString();
                });

                req.on("end", async () => {
                    let connection;
                    try {
                        const data = JSON.parse(body);
                        connection = await pool.getConnection();
                        const [rows] = await connection.execute(
                            `select points as "message" from gornikOpenDay.users where email = ?`,
                            [data.email]
                        );
                        if (rows.length === 0) {
                            throw new Error("Nieprawidłowe dane logowania");;
                        } else {
                            res.writeHead(201, { 'Content-Type': 'application/json' });
                            res.end(JSON.stringify(rows[0]));
                        }
                    } catch (err) {
                        console.error(err)
                        res.writeHead(401, { 'Content-Type': 'application/json' });
                        res.end(JSON.stringify({ error: err.message }));
                    } finally {
                        if (connection) connection.release();
                    }
                });
                break;
            case "/user/getTotalTime":
                body = "";

                req.on("data", chunk => {
                    body += chunk.toString();
                });

                req.on("end", async () => {
                    let connection;
                    try {
                        const data = JSON.parse(body);
                        connection = await pool.getConnection();
                        const [rows] = await connection.execute(
                            `SELECT sum(uqa.time_spent) as "message" FROM users u
INNER JOIN user_questions_answered uqa ON u.id = uqa.user_id
GROUP BY u.email, u.points, uqa.correct 
having u.email=?`,
                            [data.email]
                        );
                        if (rows.length === 0) {
                            throw new Error("Nieprawidłowe dane logowania");;
                        } else {
                            res.writeHead(201, { 'Content-Type': 'application/json' });
                            res.end(JSON.stringify(rows[0]));
                        }
                    } catch (err) {
                        console.error(err)
                        res.writeHead(401, { 'Content-Type': 'application/json' });
                        res.end(JSON.stringify({ error: err.message }));
                    } finally {
                        if (connection) connection.release();
                    }
                });
                break;
        }
    } else if (req.method === "GET") {
        const fullUrl = new URL(req.url, `http://${req.headers.host}`);
        switch (fullUrl.pathname) {
            case "/email/verify":
                let connection;
                try {
                    const token = fullUrl.searchParams.get('token');

                    if (!token) {
                        res.writeHead(400, { 'Content-Type': 'text/plain; charset=utf-8' });
                        return res.end('Błąd: Brak tokenu.');
                    }
                    connection = await pool.getConnection();
                    const [rows] = await connection.execute('select id from users WHERE verified = false AND verification_token = ? AND token_created_at > NOW() - INTERVAL 1 DAY',
                        [token])
                    const isTokenValid = !(rows.length === 0);

                    if (isTokenValid) {
                        const [] = await connection.execute('update users set verified = true, verification_token = null where id = ?',
                            [rows[0].id])
                        const successPage = path.join(__dirname, 'verified.html');
                        fs.readFile(successPage, (err, content) => {
                            if (err) {
                                res.writeHead(500);
                                res.end('Error loading page');
                            } else {
                                res.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8' });
                                res.end(content);
                            }

                        });
                    } else {
                        res.writeHead(400);
                        res.end('Nieprawidłowy token.');
                    }
                } catch (err) {
                } finally {
                    if (connection) connection.release()
                }

                break;
        }
    } else {
        res.writeHead(404, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({ error: "Nie znaleziono endpointu" }));
    }
});

const PORT = process.env.PORT || 3000;

server.listen(PORT, () => {
    console.log(`Server running on http://localhost:${PORT}`);
});